"""Read-only qualification and opt-in timing for resident HSDP mesh changes.

Normal timing requests do not hash/copy tensors or insert synchronizations.
Qualification hashes full block boundaries and all masks on every rank,
selected Q/K/V, final latents, full pre-quantization video chunks and audio.
"""
import functools
import hashlib
import json
import os
from pathlib import Path


def install():
    from checkpoint_hooks import install as install_checkpoint
    from hsdp_probe_hooks import install as install_hsdp
    install_checkpoint()
    install_hsdp()
    destination = os.environ.get("FASTH3_RUN_DIR")
    if not destination:
        return
    import torch
    import torch.distributed as dist
    from vllm_omni.diffusion.models.minimax_h3 import pipeline_minimax_h3 as pipeline
    from vllm_omni.diffusion.models.minimax_h3.attention import fastvideo_h3 as attention
    from vllm_omni.diffusion.models.minimax_h3.minimax_h3_transformer import MiniMaxH3DiTModel, MiniMaxH3DiTBlock
    from vllm_omni.diffusion.models.minimax_h3.vae import MiniMaxH3VideoVAE, MiniMaxH3AudioVAE
    cls = pipeline.MiniMaxH3Pipeline
    if getattr(cls, "_hsdp_shard_qualification", False):
        return
    root = Path(destination)
    state = dict(cfg={}, step=0, layer=-1, records=[], steps=[], diffuse=None, active_step=None)

    def capture(label, tensor, **metadata):
        # Move first, then materialize contiguous CPU storage: no extra GPU copy.
        host = tensor.detach().to(device="cpu").contiguous()
        raw = host.reshape(-1).view(torch.uint8).numpy()
        state["records"].append(dict(
            label=label, step=state["step"], layer=state["layer"],
            shape=list(tensor.shape), dtype=str(tensor.dtype),
            sha256=hashlib.sha256(memoryview(raw)).hexdigest(), **metadata))

    def event():
        result = torch.cuda.Event(enable_timing=True)
        result.record()
        return result

    def step_pre(module, args, kwargs):
        if state["cfg"].get("profile_hsdp"):
            state["active_step"] = event()

    def step_post(module, args, kwargs, result):
        if state["cfg"].get("profile_hsdp"):
            state["steps"].append((state["active_step"], event()))

    original_forward = cls.forward

    @functools.wraps(original_forward)
    def request(self, *args, **kwargs):
        cfg = json.loads((root / "control.json").read_text())
        state.update(cfg=cfg, step=0, layer=-1, records=[], steps=[], diffuse=None, active_step=None)
        for model in (self.transformer, getattr(self, "transformers_ref", None)):
            if model is not None and not getattr(model, "_hsdp_step_events", False):
                model.register_forward_pre_hook(step_pre, prepend=True, with_kwargs=True)
                model.register_forward_hook(step_post, with_kwargs=True)
                model._hsdp_step_events = True
        result = original_forward(self, *args, **kwargs)
        if cfg.get("qualify_hsdp") or cfg.get("profile_hsdp"):
            folder = root / cfg["name"]
            folder.mkdir(parents=True, exist_ok=True)
            rank = dist.get_rank()
            if cfg.get("qualify_hsdp"):
                (folder / f"rank{rank}-qualification.json").write_text(json.dumps(dict(
                    rank=rank, records=state["records"], completed=True,
                    scope="All block inputs/outputs and masks; QKV at steps 0,3,7 and layers 0,25,49; all final latents and pre-quantization decoded video/audio."
                ), indent=2) + "\n")
            if cfg.get("profile_hsdp"):
                torch.cuda.synchronize()
                (folder / f"rank{rank}-steps.json").write_text(json.dumps(dict(
                    rank=rank, step_gpu_ms=[a.elapsed_time(b) for a,b in state["steps"]],
                    diffuse_gpu_ms=state["diffuse"][0].elapsed_time(state["diffuse"][1]),
                    max_allocated_bytes=torch.cuda.max_memory_allocated(),
                    max_reserved_bytes=torch.cuda.max_memory_reserved(),
                ), indent=2) + "\n")
        return result

    cls.forward = request
    original_diffuse = cls.diffuse

    @functools.wraps(original_diffuse)
    def diffuse(self, *args, **kwargs):
        if not state["cfg"].get("profile_hsdp"):
            return original_diffuse(self, *args, **kwargs)
        start = event()
        result = original_diffuse(self, *args, **kwargs)
        state["diffuse"] = (start, event())
        return result

    cls.diffuse = diffuse
    original_dit = MiniMaxH3DiTModel.forward

    @functools.wraps(original_dit)
    def dit(self, **kwargs):
        state["layer"] = -1
        result = original_dit(self, **kwargs)
        state["step"] += 1
        return result

    MiniMaxH3DiTModel.forward = dit
    original_block = MiniMaxH3DiTBlock.forward

    @functools.wraps(original_block)
    def block(self, x, **kwargs):
        if not state["cfg"].get("qualify_hsdp"):
            return original_block(self, x, **kwargs)
        state["layer"] += 1
        capture("block_input", x)
        result = original_block(self, x, **kwargs)
        capture("block_output", result)
        return result

    MiniMaxH3DiTBlock.forward = block
    original_core = attention.fastvideo_block_sparse_attn_bshd

    @functools.wraps(original_core)
    def core(q, k, v, mask, sizes, logical_blocks, block_size=64):
        if state["cfg"].get("qualify_hsdp"):
            capture("route_mask", mask, logical_blocks=int(logical_blocks), block_size=int(block_size))
            capture("route_sizes", sizes)
            if state["step"] in (0, 3, 7) and state["layer"] in (0, 25, 49):
                for label, tensor in (("q",q),("k",k),("v",v)):
                    capture(label, tensor)
        return original_core(q, k, v, mask, sizes, logical_blocks, block_size)

    attention.fastvideo_block_sparse_attn_bshd = core
    original_unpack = cls._unpack_denoised_rows

    @functools.wraps(original_unpack)
    def unpack(self, *args, **kwargs):
        result = original_unpack(self, *args, **kwargs)
        if state["cfg"].get("qualify_hsdp"):
            capture("video_latent", result[0])
            capture("audio_latent", result[1])
        return result

    cls._unpack_denoised_rows = unpack
    original_video = MiniMaxH3VideoVAE.decode_with_chunks

    @functools.wraps(original_video)
    def video(self, z, *, on_chunk):
        if not state["cfg"].get("qualify_hsdp"):
            return original_video(self, z, on_chunk=on_chunk)
        def checked_chunk(chunk):
            capture("video_fp32_chunk", chunk)
            return on_chunk(chunk)
        return original_video(self, z, on_chunk=checked_chunk)

    MiniMaxH3VideoVAE.decode_with_chunks = video
    original_audio = MiniMaxH3AudioVAE.decode_latent

    @functools.wraps(original_audio)
    def audio(self, *args, **kwargs):
        result = original_audio(self, *args, **kwargs)
        if state["cfg"].get("qualify_hsdp"):
            capture("audio_fp32", result)
        return result

    MiniMaxH3AudioVAE.decode_latent = audio
    cls._hsdp_shard_qualification = True
    print(f"HSDP_SHARD_QUALIFICATION_INSTALLED pid={os.getpid()}", flush=True)
