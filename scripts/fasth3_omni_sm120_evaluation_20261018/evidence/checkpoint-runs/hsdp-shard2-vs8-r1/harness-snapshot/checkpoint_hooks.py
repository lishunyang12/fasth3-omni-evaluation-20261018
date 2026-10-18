"""Opt-in experimental hooks; no production patches or changed attention math."""
import functools
import json
import os
from pathlib import Path


def install():
    destination = os.environ.get("FASTH3_RUN_DIR")
    if not destination:
        return
    import torch
    import torch.distributed as dist
    from vllm_omni.diffusion.models.minimax_h3.attention import fastvideo_h3 as attention
    from vllm_omni.diffusion.models.minimax_h3.minimax_h3_transformer import MiniMaxH3DiTModel
    from vllm_omni.diffusion.models.minimax_h3.pipeline_minimax_h3 import MiniMaxH3Pipeline
    from vllm_omni.diffusion.forward_context import get_forward_context, is_forward_context_available

    if getattr(MiniMaxH3DiTModel, "_checkpoint_probe_installed", False):
        return
    root = Path(destination)
    state = dict(config={}, request=None, step=0, records=[], active=None)

    def rank():
        return dist.get_rank() if dist.is_initialized() else 0

    def config():
        return json.loads((root / "control.json").read_text())

    def event():
        result = torch.cuda.Event(enable_timing=True)
        result.record()
        return result

    kernel = attention.fastvideo_block_sparse_attn_bshd

    @functools.wraps(kernel)
    def core(q, k, v, mask, sizes, logical_blocks, block_size=64):
        item = state["active"]
        if item is None:
            return kernel(q, k, v, mask, sizes, logical_blocks, block_size)
        cfg = state["config"]
        if cfg["mode"] == "capture":
            logical_mask = mask[..., :logical_blocks, :logical_blocks]
            logical_sizes = sizes[:logical_blocks]
            item["counts_tensor"] = (logical_mask & (logical_sizes > 0)).sum(-1)
            item["sizes_tensor"] = logical_sizes
            item["shape"] = list(q.shape)
            item["logical_blocks"] = logical_blocks
            selected = state["step"] in cfg.get("capture_steps", [0, 3, 7]) and item["layer"] in cfg.get("capture_layers", [0, 25, 49])
            selected = selected and rank() in cfg.get("capture_ranks", [0])
            if selected:
                folder = root / cfg["name"] / "activations"
                folder.mkdir(parents=True, exist_ok=True)
                path = folder / f"rank{rank()}-step{state['step']}-layer{item['layer']}.pt"
                torch.save(dict(q=q.detach().cpu(), k=k.detach().cpu(), v=v.detach().cpu(), mask=mask.cpu(), sizes=sizes.cpu(), logical_blocks=logical_blocks, block_size=block_size), path)
                item["activation_file"] = str(path)
        start = event()
        output = kernel(q, k, v, mask, sizes, logical_blocks, block_size)
        end = event()
        item["core_events"] = (start, end)
        return output

    attention.fastvideo_block_sparse_attn_bshd = core
    forward_vsa = attention.MiniMaxH3VSAImpl.forward_cuda

    @functools.wraps(forward_vsa)
    def vsa(self, q, k, v, attn_metadata=None):
        # The text refiner uses the same implementation class with a dense
        # fallback. Only count the 50 video DiT layers in VSA layer indices.
        is_video = attn_metadata is not None and attn_metadata.video_layout is not None
        if not is_video or state["config"].get("mode") not in ("capture", "timing"):
            return forward_vsa(self, q, k, v, attn_metadata)
        item = dict(layer=len(state["records"]))
        state["records"].append(item)
        state["active"] = item
        start = event()
        try:
            result = forward_vsa(self, q, k, v, attn_metadata)
            end = event()
            item["full_events"] = (start, end)
            return result
        finally:
            state["active"] = None

    attention.MiniMaxH3VSAImpl.forward_cuda = vsa
    forward_dit = MiniMaxH3DiTModel.forward

    @functools.wraps(forward_dit)
    def dit(self, **kwargs):
        cfg = config()
        if cfg["name"] != state["request"]:
            state["request"] = cfg["name"]
            state["step"] = 0
        state["config"] = cfg
        state["records"] = []
        if cfg["provider"] != "fi":
            raise RuntimeError("The production SM120 integration now uses FlashInfer only. "
                               "Native comparisons require native128-framework-snapshot.py; "
                               "do not label the current FlashInfer path as native.")
        os.environ["FASTVIDEO_VSA_SM120"] = "0"
        os.environ["FASTVIDEO_VSA_SM120_SPLITS"] = str(cfg.get("splits", 1))
        result = forward_dit(self, **kwargs)
        records = state["records"]
        if records:
            torch.cuda.synchronize()
            for item in records:
                for key in ("core", "full"):
                    events = item.pop(f"{key}_events", None)
                    if events:
                        item[f"{key}_ms"] = events[0].elapsed_time(events[1])
                counts = item.pop("counts_tensor", None)
                sizes = item.pop("sizes_tensor", None)
                if counts is not None:
                    item["counts"] = counts.cpu().tolist()
                    item["sizes"] = sizes.cpu().tolist()
            folder = root / cfg["name"]
            folder.mkdir(parents=True, exist_ok=True)
            published_step = get_forward_context().denoise_step_idx if is_forward_context_available() else None
            with (folder / f"rank{rank()}-attention.jsonl").open("a") as stream:
                stream.write(json.dumps(dict(step=state["step"], published_step=published_step, rank=rank(), mode=cfg["mode"], provider=cfg["provider"], layers=records)) + "\n")
        state["step"] += 1
        return result

    MiniMaxH3DiTModel.forward = dit
    unpack = MiniMaxH3Pipeline._unpack_denoised_rows

    @functools.wraps(unpack)
    def unpack_and_save(self, *args, **kwargs):
        result = unpack(self, *args, **kwargs)
        cfg = state["config"]
        if rank() == 0 and cfg.get("save_latents", False):
            folder = root / cfg["name"]
            folder.mkdir(parents=True, exist_ok=True)
            torch.save(dict(video=result[0].detach().cpu(), audio=result[1].detach().cpu()), folder / "latents.pt")
        return result

    MiniMaxH3Pipeline._unpack_denoised_rows = unpack_and_save
    MiniMaxH3DiTModel._checkpoint_probe_installed = True
    print(f"CHECKPOINT_HOOKS_INSTALLED pid={os.getpid()}", flush=True)
