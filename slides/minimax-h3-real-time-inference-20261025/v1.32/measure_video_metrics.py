"""Reproduce full-resolution, frame-aligned LPIPS and RGB SSIM for this release.

Requires torch, torchvision, lpips==0.1.4, scikit-image==0.26.0 and ffmpeg.
Run: python measure_video_metrics.py --device cuda:0
"""
from pathlib import Path
import argparse
import csv
import hashlib
import importlib.metadata
import json
import os
import subprocess
import time

import numpy as np
import torch
import lpips
from skimage.metrics import structural_similarity


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def frames(path, width, height):
    command = ['ffmpeg', '-v', 'error', '-threads', '2', '-i', str(path),
               '-map', '0:v:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
               '-threads', '2', 'pipe:1']
    process = subprocess.Popen(command, stdout=subprocess.PIPE)
    size = width * height * 3
    try:
        while True:
            data = process.stdout.read(size)
            if not data:
                break
            if len(data) != size:
                raise RuntimeError('Truncated decoded frame')
            yield np.frombuffer(data, np.uint8).reshape(height, width, 3).copy()
        assert process.wait() == 0
    finally:
        process.stdout.close()
        if process.poll() is None:
            process.terminate()
            process.wait()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument('--device', default='cpu')
    args = parser.parse_args()
    root = args.root
    names = ['bf16_ref', 'online_nvfp4', 'qad_nvfp4', 'qad_nvfp4_sage']
    paths = [root / 'media' / (name + '.mp4') for name in names]
    probes = [json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-select_streams', 'v:0', '-count_frames',
        '-show_entries', 'stream=width,height,r_frame_rate,nb_read_frames',
        '-of', 'json', str(path)], text=True))['streams'][0] for path in paths]
    assert all(p == probes[0] for p in probes), probes
    width, height = probes[0]['width'], probes[0]['height']
    assert (width, height, probes[0]['nb_read_frames'], probes[0]['r_frame_rate']) == (1344, 768, '124', '24/1')
    torch.set_num_threads(4)
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    model = lpips.LPIPS(net='alex', version='0.1', lpips=True,
                        pnet_rand=False, pretrained=True).to(args.device).eval()
    ssim_args = dict(data_range=255, channel_axis=-1, gaussian_weights=True,
                     sigma=1.5, win_size=11, use_sample_covariance=False,
                     K1=0.01, K2=0.03)
    rows = []
    start = time.monotonic()
    self_check = None
    readers = [frames(path, width, height) for path in paths]
    with torch.inference_mode():
        for index, trio in enumerate(zip(*readers, strict=True)):
            ref = trio[0]
            tensors = torch.from_numpy(np.stack(trio)).permute(0, 3, 1, 2).to(args.device, torch.float32).div_(127.5).sub_(1)
            values = model(tensors[0:1].expand(len(names)-1, -1, -1, -1), tensors[1:]).reshape(-1).cpu().tolist()
            if index == 0:
                self_check = {'lpips': model(tensors[:1], tensors[:1]).item(),
                              'ssim': float(structural_similarity(ref, ref, **ssim_args))}
                assert abs(self_check['lpips']) < 1e-8 and self_check['ssim'] == 1
            for name, target, value in zip(names[1:], trio[1:], values):
                rows.append({'variant': name, 'frame': index, 'time_seconds': index/24,
                             'lpips_alex_v0_1': value,
                             'ssim_rgb': float(structural_similarity(ref, target, **ssim_args))})
            if index % 20 == 0:
                print(json.dumps({'frames_done': index+1, 'elapsed_seconds': time.monotonic()-start}), flush=True)
    assert len(rows) == 124*(len(names)-1)
    assert all(np.isfinite(row['lpips_alex_v0_1']) and np.isfinite(row['ssim_rgb']) for row in rows)
    summary = {}
    for name in names[1:]:
        selected = [r for r in rows if r['variant'] == name]
        summary[name] = {}
        for metric in ['lpips_alex_v0_1', 'ssim_rgb']:
            values = np.array([r[metric] for r in selected])
            summary[name][metric] = {'mean': float(values.mean()), 'std_population': float(values.std()),
                                     'min': float(values.min()), 'max': float(values.max()),
                                     'frames': len(values)}
    calibration = Path(lpips.__file__).parent / 'weights/v0.1/alex.pth'
    backbone = Path(torch.hub.get_dir()) / 'checkpoints/alexnet-owt-7be5be79.pth'
    report = {
        'status': 'complete', 'reference': 'bf16_ref',
        'videos': {name: {'file': 'media/'+path.name, 'sha256': sha(path), **probe}
                   for name, path, probe in zip(names, paths, probes)},
        'method': {'decode': 'ffmpeg RGB24, original resolution; no resize or crop',
                   'alignment': 'Same frame index 0..123; no temporal or spatial registration',
                   'aggregation': 'Unweighted arithmetic mean over all 124 frames',
                   'lpips': {'backbone': 'ImageNet pretrained AlexNet', 'version': '0.1',
                             'input': 'float32 RGB normalized to [-1,1]', 'learned_calibration': True,
                             'backbone_sha256': sha(backbone), 'calibration_sha256': sha(calibration),
                             'direction': 'lower is closer to BF16'},
                   'ssim': {'color_space': 'RGB, arithmetic mean over channels', **ssim_args,
                            'direction': 'higher is closer to BF16'}},
        'versions': {name: importlib.metadata.version(name) for name in
                     ['torch', 'torchvision', 'lpips', 'numpy', 'scikit-image']},
        'device': args.device, 'self_comparison_sanity_check': self_check,
        'results': summary, 'elapsed_seconds': time.monotonic()-start,
        'scope': ['Single prompt, seed 1234, one reference image, 8 denoising steps.',
                  'Metrics compare decoded MP4 frames, including compression effects; audio is not scored.',
                  'Framewise similarity to BF16 is not an overall perceptual or temporal quality score.',
                  'All four use the same original BF16 encoder, original VAE and single-GPU layerwise CPU offload. The fourth adds CAKE Sage attention with unchanged logical sparse routing.',
                  'Published QAD DiT is compared with direct NVFP4 and its source BF16 checkpoint; one sample does not isolate every training change.',
                  'Crowd motion and spatial alignment can diverge across models; framewise scores do not isolate texture preservation or motion correctness.'],
        'sources': ['https://github.com/richzhang/PerceptualSimilarity',
                    'https://scikit-image.org/docs/stable/api/skimage.metrics.html#skimage.metrics.structural_similarity']}
    with (root/'video-metrics-per-frame.csv').open('w') as file:
        writer = csv.DictWriter(file, fieldnames=list(rows[0]), lineterminator='\n')
        writer.writeheader(); writer.writerows(rows)
    (root/'video-metrics.json').write_text(json.dumps(report, indent=2))
    print(json.dumps({'results': summary, 'elapsed_seconds': report['elapsed_seconds']}), flush=True)


if __name__ == '__main__':
    main()
