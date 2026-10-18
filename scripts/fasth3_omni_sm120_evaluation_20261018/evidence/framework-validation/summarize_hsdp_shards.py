"""Validate and summarize a completed resident HSDP2/HSDP8 experiment."""
from collections import Counter
import hashlib
import json
from pathlib import Path
import statistics
import sys


root = Path(sys.argv[1]).resolve()
status = json.loads((root / "status.json").read_text())
experiment = json.loads((root / "experiment.json").read_text())
expected_hash = "648ab86a9cface68d7402a6dbd5386a52e2071c293add2a9560dc9ef2b1aa79d"
summary = {"arms": {}, "qualification": {}, "mismatches": []}
all_records = {}

settings = {arm: json.loads((root / arm / "settings.json").read_text()) for arm in ("hsdp2", "hsdp8")}
for key in ("image", "image_sha256", "prompt", "cases"):
    assert settings["hsdp2"][key] == settings["hsdp8"][key], key
config2, config8 = (settings[arm]["settings"] for arm in ("hsdp2", "hsdp8"))
assert config2.keys() == config8.keys()
changed = {key for key in config2 if config2[key] != config8[key]}
assert changed == {"hsdp_shard_size", "hsdp_replicate_size"}, changed
summary["configuration_differences"] = {key: {arm: settings[arm]["settings"][key] for arm in settings} for key in sorted(changed)}

for name, digest in experiment["harness_sha256"].items():
    assert hashlib.sha256((root / "harness-snapshot" / name).read_bytes()).hexdigest() == digest

for arm in ("hsdp2", "hsdp8"):
    arm_status = status["arms"][arm]
    assert arm_status.get("returncode") == 0, arm_status
    assert arm_status["source_unchanged"] and not arm_status["gpu_apps_after"], arm_status
    results = json.loads((root / arm / "results.json").read_text())
    steady = [x for x in results if "repeat" in x["case"]["name"]]
    assert len(steady) == 3
    hashes = {}
    for result in results:
        if "warmup" in result["case"]["name"]:
            continue
        digest = hashlib.sha256(Path(result["video"]).read_bytes()).hexdigest()
        hashes[result["case"]["name"]] = digest
        if digest != expected_hash:
            summary["mismatches"].append({"arm": arm, "case": result["case"]["name"], "kind": "mp4"})
    summary["arms"][arm] = dict(
        steady_seconds=[x["seconds"] for x in steady],
        median_seconds=statistics.median(x["seconds"] for x in steady),
        peak_reserved_gib=[x["peak_memory_mb"] / 1024 for x in steady],
        output_sha256=hashes,
    )
    qualification = []
    timing = []
    for rank in range(8):
        folder = root / arm / "fi-124-qualification"
        payload = json.loads((folder / f"rank{rank}-qualification.json").read_text())
        assert payload["completed"] and payload["rank"] == rank
        records = payload["records"]
        counts = Counter(item["label"] for item in records)
        for label in ("block_input", "block_output", "route_mask", "route_sizes"):
            assert counts[label] == 400, (arm, rank, counts)
            positions = {(item["step"], item["layer"]) for item in records if item["label"] == label}
            assert positions == {(s,l) for s in range(8) for l in range(50)}, (arm,rank,label)
        for label in ("q", "k", "v"):
            assert counts[label] == 9, (arm,rank,counts)
        for label in ("video_latent", "audio_latent", "audio_fp32"):
            assert counts[label] == 1, (arm,rank,counts)
        frames = [x for x in records if x["label"] == "video_fp32_chunk"]
        if rank == 0:
            assert frames and sum(x["shape"][2] for x in frames) == 124, frames
            assert all(x["dtype"] == "torch.float32" for x in frames), frames
            assert all(x["shape"][-2:] == [768,1344] for x in frames), frames
        else:
            assert not frames, (arm,rank,frames)
        qualification.append({"rank": rank, "counts": dict(counts)})
        all_records[arm, rank] = records
        folder = root / arm / "fi-124-profile"
        step = json.loads((folder / f"rank{rank}-steps.json").read_text())
        groups = json.loads((folder / f"rank{rank}-hsdp.json").read_text())
        assert len(step["step_gpu_ms"]) == 8, step
        for phase in ("pre", "post"):
            assert sum(x["phase"] == phase for x in groups["records"]) == 408
        before = [x for x in groups["records"] if x["phase"] == "pre"]
        timing.append(dict(rank=rank, step_gpu_seconds=[x/1000 for x in step["step_gpu_ms"]],
            total_step_gpu_seconds=sum(step["step_gpu_ms"])/1000,
            diffuse_gpu_seconds=step["diffuse_gpu_ms"]/1000,
            pre_forward_seconds=sum(x["gpu_ms"] for x in before)/1000,
            root_pre_forward_seconds=sum(x["gpu_ms"] for x in before if x["fqn"]=="")/1000,
            max_allocated_gib=step["max_allocated_bytes"]/2**30,
            max_reserved_gib=step["max_reserved_bytes"]/2**30))
    summary["arms"][arm]["profile"] = timing
    summary["qualification"][arm] = qualification

for rank in range(8):
    left, right = (all_records[arm, rank] for arm in ("hsdp2", "hsdp8"))
    assert len(left) == len(right), (rank,len(left),len(right))
    for a,b in zip(left,right):
        if a != b:
            summary["mismatches"].append({"rank":rank,"hsdp2":a,"hsdp8":b})

t2,t8 = (summary["arms"][arm]["median_seconds"] for arm in ("hsdp2","hsdp8"))
summary["latency"] = dict(hsdp2_minus_hsdp8_seconds=t2-t8, reduction_percent=100*(t8-t2)/t8,
    hsdp2_minus_previous_resident_hsdp8_seconds=t2-41.0576718589291)
summary["qualification_passed"] = not summary["mismatches"]
summary["limitations"] = (
    "One fixed 124-frame request, seed 43, with three normal repetitions per mesh. "
    "Intermediate tensors and float video/audio are compared using SHA256 over every byte "
    "of the stated tensors; selected QKV coverage is 9 points/rank. This does not qualify "
    "other shapes, seeds, or workloads. GPU pre-forward timing is exposed wait/copy-out, "
    "not the entire causal HSDP overhead."
)
(root / "summary.json").write_text(json.dumps(summary,indent=2)+"\n")
print(json.dumps({k:v for k,v in summary.items() if k not in ("qualification", "mismatches")},indent=2))
print(f"mismatches={len(summary['mismatches'])}")
if summary["mismatches"]:
    sys.exit(1)
