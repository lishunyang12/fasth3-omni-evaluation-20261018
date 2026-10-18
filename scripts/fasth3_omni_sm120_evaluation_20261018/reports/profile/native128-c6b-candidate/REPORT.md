# C6b: native128 split-KV with FP32 shared-memory output staging

This is the accepted explicit option, `num_splits=2/4/8/16`, default1.
SM120,110SM; BF16 Q/K/V and P, FP32 accumulation and partial output/LSE,
final BF16 rounding after stable logsumexp merge. Logical selections and
physical128x128 GEMM tiles are preserved. No TF32/FP8/FP4 or 64-token tiles.
Inputs are synthetic block selections, not captured FastH3 activations.
Source is frozen in harness/source; production is additionally frozen in
outputs/c6_frozen with a source manifest. Profiling uses the same kernel
and merge math, with preallocated scratch for attribution.

All12 actions have full+PM+tensor-roofline and source captures. Every
provider passed the unchanged FP32 oracle gates before collection. KDA
helpers and ncu_report generated analysis/metrics.json, raw_*.json,
timeline.txt and stalls_*.txt. Baseline seed80513, Nq=Nk=96 (12288 tokens).

| Input | Kernel | NCU us | BF16 dense SoL | SM busy |
|---|---|---:|---:|---:|
| H1 prefix | C5 | 520.45 | 10.87% | 13.80% |
| H1 prefix | split8 producer | 180.70 | 31.39% | 72.77% |
| H1 prefix | split8 merge | 61.98 | 0% | 92.38% |
| H1 prefix | FI64 | 363.84 | 15.57% | 21.46% |
| H1 random | C5 | 96.93 | 40.38% | 53.84% |
| H1 random | split8 producer | 119.55 | 32.45% | 88.62% |
| H1 random | split8 merge | 59.68 | 0% | 96.01% |
| H1 random | FI64 | 91.04 | 43.04% | 61.32% |
| H3 prefix | C5 | 524.86 | 32.38% | 40.24% |
| H3 prefix | split8 producer | 404.13 | 42.13% | 95.05% |
| H3 prefix | split8 merge | 182.37 | 0% | 99.74% |
| H3 prefix | FI64 | 462.85 | 36.79% | 47.36% |

These are isolated, default-cache-control NCU kernel replays. The merge
replay reads cold scratch (L2 hit2.46% on H1 prefix), unlike a hot producer
immediately followed by merge. Do not interpret their sum as standalone
application latency or quote producer-only SoL as combined-path efficiency.
The graph benchmark includes both kernels, and separately includes metadata
compaction; see validation-v4/holdout.json and holdout-repeat.json.

## Six analysis dimensions

1. Occupancy: C6b producer uses236 registers/thread,99456 shared bytes,
   one256-thread CTA/SM. All local-load/store spill counters are0, unlike
   C6's255 registers and337920/196608 local load/store instructions.
   Active-cycle warp occupancy16.56% is essentially unchanged from C5.
   Merge uses40 registers,9216 shared bytes,128 threads and79.13% active
   warp occupancy in H1 prefix. Higher occupancy alone is not the objective.
2. Balance: producer grid96->768 CTAs. Max SM active/mean7.230->1.353,
   busy13.80%->72.77%. More parallel tasks reduce the dense-prefix tail.
   Random H1 is already better balanced before splitting; increasing its
   busy53.84%->88.62% does NOT improve latency because more time is spent
   doing startup/output/merge work.
3. Source stalls: C6b line502 (shared-to-global FP32 output copy) records
   1705 lg_throttle and679 mio_throttle samples, the largest aggregate
   source hotspot. QK line768 has1535 math-pipe and671 wait samples;
   PV line795 has1419 math-pipe and156 wait samples. Output staging line495
   has572 mio_throttle samples. Counts are samples, not wall-time shares.
   Merge shows shared-reduction/barrier stalls and610 long_scoreboard
   samples at the partial-output read, consistent with its memory work.
4. Tensor work: H1 prefix remains1320 edges *8,388,608=11,072,962,560 FLOP
   for C5, split producer and FI64. Merge executes no Tensor Core work.
   Producer active-cycle TC utilization43.14% is below C5's78.75%: many
   tiny partitions amplify setup/softmax/epilogue cost. Producer SoL31.39%
   is an improvement, not near dense compute SoL; total path is lower.
5. Timeline: PM reports retain all12 actions. The original H1 prefix has
   a long low-utilization tail; split work spreads activity over more SMs.
   Per-SM imbalance independently confirms this. The merge is broadly
   active, max/mean1.049. ASCII plots use normalized sample positions;
   do not compare their horizontal axes as equal wall-clock durations.
6. Memory: H1 prefix producer DRAM throughput9.73%, L231.62%. TMA read
   bytes INCREASE89,653,248->111,673,344. K/V bytes stay1320*65536;
   Q loads grow96*32768->768*32768. This optimization adds parallelism,
   not a reduction in TMA traffic. FP32 scratch is50,724,864 bytes
   (B*SPLITS*Sq*H*129*4). Merge cold-replay DRAM throughput69.31%,
   L234.65%; its traffic and launch cost cannot be ignored.

## Correctness and dispatch

Each CTA uses selected-list range[floor(count*s/S),floor(count*(s+1)/S)).
Ranges are disjoint and exhaustive even when count<S. Each partial writes
normalized FP32 output and lnLSE, including exact0/-inf for empty partitions.
Merge uses exp(lse-max_lse) weights, normalizes by their sum and rounds once
to BF16. All-empty rows explicitly produce0/-inf. This preserves attention
semantics, though splitting changes finite-precision reduction order.

K/V storage is explicitly one64KiB shared allocation. A CTA barrier precedes
reuse as FP32 output, a second precedes coalesced global reads/stores. Q
remains32KiB; total shared allocation is unchanged. Sanitizer and numerical
results are consolidated in validation-v4/REPORT.txt.

Default1 retains the existing route. Higher heads, dense/random, single and
empty patterns can regress, so no shape-only automatic selection is enabled.
The final held-out suite uses seed99017 and unseen block counts20/40/88/152/264;
no kernel or split-rule changes were made after inspecting those results.
The prior C6 tuning-epilogue.json has a provider rebinding error after its
first case and is excluded from old-vs-new claims; the corrected comparison
is tuning-epilogue-corrected.json. C6b lowers H1 prefix split8 from167.83us
to159.54us in that paired training comparison, and split2 from231.73us to195.69us.

Further optimization would need to reduce partial-output traffic and
per-partition setup/epilogue cost while keeping FP32 scratch semantics.
This report does not claim full-model/video parity or universal superiority
over FI. The useful result is an explicit option for low-head-count,
uneven-work inputs, with the existing unsplit path retained.
