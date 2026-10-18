"""Pinned FastH3 Omni end-to-end inference with optional real-activation capture."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
os.environ.update(HF_HOME=str(ROOT / "hf-home"), HF_HUB_CACHE=str(ROOT / "hf-hub"), HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", VLLM_WORKER_MULTIPROC_METHOD="spawn", TOKENIZERS_PARALLELISM="false", VLLM_OMNI_VIDEO_SYNC_TIMEOUT="14400")

# multiprocessing spawn imports this file in each model worker.
from hsdp_shard_hooks import install
install()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--num-gpus", type=int, default=4)
    parser.add_argument("--usp", type=int, default=4)
    parser.add_argument("--tp", type=int, default=1)
    parser.add_argument("--te-tp", type=int, default=4)
    parser.add_argument("--hsdp", action="store_true")
    parser.add_argument("--hsdp-shard-size", type=int, required=True)
    parser.add_argument("--no-profile", action="store_true")
    parser.add_argument("--follow-cases", action="store_true", help="Accept appended cases until the cases file has a .done sibling")
    parser.add_argument("--image", type=Path, default=ROOT.parent / "minimax-h3-native/FastVideo/assets/images/saxophonist.jpg")
    args = parser.parse_args()
    for executable in ("ffmpeg", "ffprobe"):
        if shutil.which(executable) is None:
            raise RuntimeError(f"Missing media-validation prerequisite: {executable}")
    args.run_dir = args.run_dir.resolve()
    args.run_dir.mkdir(parents=True, exist_ok=True)
    os.environ["FASTH3_RUN_DIR"] = str(args.run_dir)
    install()
    from PIL import Image
    from vllm_omni.entrypoints.omni import Omni
    from vllm_omni.inputs.data import OmniDiffusionSamplingParams

    paths = json.loads((ROOT / "framework-validation/checkpoint-paths.json").read_text())
    cases = json.loads(args.cases.read_text())
    prompt = (ROOT / "framework-validation/benchmark-prompt.txt").read_text()
    settings = dict(model=paths["student"], model_class_name="MiniMaxH3Pipeline", trust_remote_code=True,
                    task_type="ref2va", num_gpus=args.num_gpus, tensor_parallel_size=args.tp,
                    ulysses_degree=args.usp, ring_degree=1, text_encoder_tp_size=args.te_tp,
                    vae_patch_parallel_size=args.num_gpus, vae_parallel_mode="tile", vae_use_tiling=True,
                    use_hsdp=args.hsdp, hsdp_shard_size=args.hsdp_shard_size, hsdp_replicate_size=args.num_gpus // args.hsdp_shard_size,
                    enforce_eager=True, diffusion_attention_backend="FASTVIDEO_VSA",
                    enable_diffusion_pipeline_profiler=not args.no_profile, max_num_seqs=1,
                    stage_init_timeout=1800, init_timeout=1800)
    (args.run_dir / "settings.json").write_text(json.dumps(dict(settings=settings, image=str(args.image), image_sha256=hashlib.sha256(args.image.read_bytes()).hexdigest(), prompt=prompt, cases=cases), indent=2) + "\n")
    (args.run_dir / "control.json").write_text(json.dumps(cases[0]))
    start = time.perf_counter()
    engine = Omni(**settings)
    print(f"MODEL_READY init_s={time.perf_counter()-start:.3f}", flush=True)
    results = []
    try:
        case_index = 0
        while True:
            if args.follow_cases:
                cases = json.loads(args.cases.read_text())
            if case_index >= len(cases):
                if not args.follow_cases or args.cases.with_suffix(".done").exists():
                    break
                time.sleep(1)
                continue
            case = cases[case_index]
            folder = args.run_dir / case["name"]
            folder.mkdir(parents=True, exist_ok=True)
            temporary = args.run_dir / "control.tmp"
            temporary.write_text(json.dumps(case))
            temporary.replace(args.run_dir / "control.json")
            frames = case.get("frames", 124)
            sampling = OmniDiffusionSamplingParams(height=768, width=1344, fps=24, num_frames=frames, num_inference_steps=8,
                seed=case.get("seed", 43), guidance_scale=1.0,
                extra_args=dict(task="ref2va", duration=frames/24, aspect_ratio="16:9", flow_shift=12.0,
                                audio_flow_shift=3.0, preencode_mp4=True))
            request = dict(prompt=prompt, modalities=["video"], multi_modal_data=dict(image=[Image.open(args.image).convert("RGB")]))
            start = time.perf_counter()
            outputs = engine.generate(request, sampling, use_tqdm=False)
            duration = time.perf_counter() - start
            output = outputs[0]
            video = output.images
            while isinstance(video, (tuple, list)) and len(video) == 1:
                video = video[0]
            assert isinstance(video, (bytes, bytearray)), type(video)
            target = folder / "output.mp4"
            target.write_bytes(video)
            probe = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", str(target)], text=True))
            subprocess.run(["ffmpeg", "-v", "error", "-i", str(target), "-f", "null", "-"], check=True)
            vstream = next(s for s in probe["streams"] if s["codec_type"] == "video")
            astream = next(s for s in probe["streams"] if s["codec_type"] == "audio")
            assert (int(vstream["width"]), int(vstream["height"]), int(vstream["nb_read_frames"])) == (1344, 768, frames)
            assert int(astream["sample_rate"]) == 32000 and int(astream["channels"]) == 2
            result = dict(case=case, seconds=duration, stage_durations=getattr(output, "stage_durations", None),
                          peak_memory_mb=getattr(output, "peak_memory_mb", None), video=str(target), probe=probe)
            results.append(result)
            (args.run_dir / "results.json").write_text(json.dumps(results, indent=2, default=str) + "\n")
            print("CASE_COMPLETE " + json.dumps(dict(name=case["name"], seconds=duration, frames=frames, stage_durations=result["stage_durations"])), flush=True)
            case_index += 1
    finally:
        engine.close()


if __name__ == "__main__":
    main()
