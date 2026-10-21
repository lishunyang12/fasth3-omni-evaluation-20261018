# FastH3 · Precision in Motion

A static comparison page for five scenes and three configurations: BF16, NVFP4 QAD, and NVFP4 QAD with the fast-8L video decoder. All clips retain the original generated video and stereo audio.

Run locally:

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000`. For GitHub Pages, put these files at the repository root, then select **Settings → Pages → Deploy from a branch → main / (root)**. The directory also works with any static host. No build or API key is required.

The main performance table uses one excluded warmup and three measured requests of the family scene on four RTX PRO 5000 72GB GPUs. The additional scenes are qualitative samples, one per configuration. Attention replay measurements are reported separately from end-to-end video latency. Full inputs, checkpoint provenance, and numeric data are included under `data/`.

Reference images come from the FastVideo example assets; each scene identifies its source. Noto Sans CJK is distributed under the SIL Open Font License in `assets/FONT-LICENSE.txt`.
