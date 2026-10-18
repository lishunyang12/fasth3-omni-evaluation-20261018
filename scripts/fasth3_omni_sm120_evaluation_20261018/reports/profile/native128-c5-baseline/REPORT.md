# C4.1 regression diagnosis before C5

SM120, 110 SMs, BF16 D128, synthetic logical128 selections; seed 58013.
This is kernel evidence, not measured FastH3 activation or video parity.
`harness/source/` freezes C4.1. Full+PM+tensor-roofline and source reports
are in `reports/`; every action was parsed using `ncu_report` and pinned
KDA helpers into `analysis/metrics.json`, `timeline.txt`, `stalls_*.txt`.
All profiled providers passed the existing independent FP32 gates first.

| Shape | Provider | NCU ms | BF16 SoL | SM busy | Active-cycle TC |
|---|---|---:|---:|---:|---:|
| 18432, H14 | C4.1 | 2.563 | 73.24% | 86.53% | 84.64% |
| 18432, H14 | FI64 | 2.567 | 73.19% | 87.92% | 83.25% |
| 10240, H1 | C4.1 | .434 | 10.81% | 13.62% | 79.36% |
| 10240, H1 | FI64 | .307 | 15.34% | 21.99% | 69.76% |
| 10240, H14, ragged | C4.1 | .868 | 75.87% | 95.33% | 79.59% |
| 10240, H14, ragged | FI64 | .608 | 62.67% | 79.22% | 79.10% |

These are profiler timings, not standalone speed ratios. SoL is the actual
BF16-input/FP32-accumulate HMMA operation count versus sustained dense peak,
not 2:4 hardware sparse peak. SM busy is active/elapsed SM cycles.

## Six dimensions

1. **Occupancy.** Native remains one 256-thread CTA per SM (241 registers
   per thread, 99456 shared bytes), about 16.7% theoretical warp occupancy.
   FI uses two 128-thread CTAs per SM. No register-spill explanation for
   these regressions was found; neither kernel spills local loads/stores.
2. **Balance.** At 18432/H14 native maximum SM active cycles / mean = 1.154,
   with 2016 CTAs and 18.33 waves. The 128-query grouping introduced at
   16K delays dense-prefix work on later heads. At H1, just 80 CTAs and two
   much longer dense-prefix CTAs create severe imbalance: max/mean=7.317.
   The latter cannot be fixed merely by permuting the same 80 CTAs.
3. **Stalls.** Source sampling concentrates at QK MMA line739, PV MMA line766
   and the adjacent ldmatrix line763. On the 18K native action, QK records
   47674 math-pipe and 23354 wait samples; PV records 46905 math-pipe samples.
   These are sample counts, not fractions of wall time. Changing the MMA
   pipeline is less directly supported than improving work balance here.
4. **Tensor work.** At 18K both providers execute 367.354 GFLOP. On ragged
   input native executes 128.715 GFLOP versus FI's 74.281 GFLOP. Native's
   higher SoL therefore does not imply lower latency: FI removes empty
   64-token children while native still computes whole selected128 tiles.
   Of 15344 native edges, 2641 have size=0 (17.21%). Filtering these is exact;
   partial but nonempty tiles must still remain128 under this task's contract.
5. **Timeline.** PM samples are retained for all six actions. The 18K trace
   has a declining tail after the sustained busy interval. H1 has a much
   longer low-utilization tail; mean busy metrics alone understate the
   imbalance between the two dense rows and the rest. PM axes in the ASCII
   output are normalized sample positions, not comparable durations.
6. **Memory.** Native DRAM throughput is 12.46%, 1.53%, 14.34% for the three
   cases; L2 throughput is 24.59%, 3.75%, 26.15%. These do not support a DRAM
   bandwidth diagnosis. Keep long-sequence query locality while addressing
   dispatch order. NCU's generic uncoalesced scalar-load recommendation is
   not accepted as a global speed estimate without an experiment.

## Ranked experiments

1. Try a small first query group across heads, then large groups. Uniform
   small groups improved medium prefix cases but regressed long sequences
   in `validation-v3/tuning-scheduler.json`.
2. Remove size=0 blocks during mask compaction, preserving all nonempty
   selections and physical128 arithmetic. Compare metadata-inclusive costs.
3. H1 would require additional parallelism, such as splitting KV lists and
   merging partial softmax results. This is a distinct kernel design and
   is not claimed fixed by the two bounded experiments above.
