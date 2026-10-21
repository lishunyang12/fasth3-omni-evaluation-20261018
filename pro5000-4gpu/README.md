# FastH3 evaluation on four RTX PRO 5000 GPUs

[Open the evaluation](https://lishunyang12.github.io/fasth3-omni-evaluation-20261018/pro5000-4gpu/).

The checkpoint comparison covers original BF16, FP8, NVFP4 QAD, and NVFP4 QAD with the fast 8L video decoder. Each configuration includes five scenes with single-image, multiple-image, and video conditioning. All clips retain the generated colors and stereo audio.

The [attention comparison](attention/) evaluates NVIDIA cuDNN BF16, FastVideo Triton BF16, and experimental FlashInfer CAKE Sage with the original BF16 weights and decoder. CAKE Sage uses INT8 Q/K and FP8 V. The [BF16 comparison](bf16/) isolates the two BF16 attention providers.

Performance tables report the median of three single-image dinner requests after one excluded warmup: 1344 × 768, 124 frames, eight denoising steps, and seed 1234. Other scene and input combinations are qualitative samples. Checkpoint deployment speedups include the change from sharded BF16 to unsharded quantized DiT weights. Attention replay timings are separate from end-to-end latency. Frame-aligned SSIM and PSNR measure output differences; they are not perceptual quality ratings.

Use the scene and input tabs to compare outputs, play them together, select one audio track, or inspect paired frames. CSV measurements and JSON provenance are linked from each page. Reference images come from the FastVideo example assets; paired-image and video fixtures are shared derivatives of earlier BF16 outputs.

This directory is a static site with no build step or API key. Serve it over HTTP using a server that supports byte-range requests for reliable video seeking.
