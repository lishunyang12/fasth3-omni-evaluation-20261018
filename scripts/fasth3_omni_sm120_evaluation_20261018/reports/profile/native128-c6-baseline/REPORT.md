# C6 baseline: low-head-count parallelism

SM120, 110 SMs; BF16 Q/K/V and P, FP32 accumulation, D128. Synthetic
logical128 selections, Nq=Nk=96 blocks (12288 tokens), seed80513. Frozen
C5 and pinned FI f75bed5. Every action passed the unchanged FP32 oracle
gates before profiling. Full+PM+tensor roofline and source captures were
parsed with ncu_report and KDA helpers; see analysis/metrics.json,
analysis/timeline.txt and analysis/stalls_*.txt. Source is frozen in harness/source.

| Input | Kernel | NCU ms | BF16 dense SoL | SM busy | Active-cycle tensor utilization |
|---|---|---:|---:|---:|---:|
| H1 prefix | C5 | .520896 | 10.854% | 13.793% | 78.691% |
| H1 prefix | FI64 | .363648 | 15.599% | 21.478% | 72.629% |
| H1 random | C5 | .096256 | 40.432% | 53.808% | 75.142% |
| H1 random | FI64 | .091072 | 43.057% | 61.341% | 70.193% |
| H3 prefix | C5 | .526016 | 32.403% | 40.262% | 80.480% |
| H3 prefix | FI64 | .463104 | 36.832% | 47.452% | 77.620% |

Profiler durations are for diagnosis. Standalone graph measurements are
reported separately and must include the split producer AND merge.

## Metric denominators (H1 prefix)

- CTA count = B * H * (Sq / 128) = 1 * 1 * 96 = 96. This kernel supports
  one resident 256-thread CTA/SM. 96/110=87.27% is possible simultaneous
  SM coverage, not the full-duration average.
- SM busy = sm__cycles_active.avg / sm__cycles_elapsed.avg =
  124923.372727 / 905711.872727 = 13.792838%. An active cycle includes
  periods with resident work stalled; it does not imply instruction issue.
- Tensor FLOP count = 1320 selected Q/KV block pairs * 2 GEMMs *
  (2 * 128 * 128 * 128 FLOP/GEMM) = 11072962560 FLOP. NCU's actual
  BF16-input / FP32-accumulate / sparsity-off operation counter agrees.
- Achieved tensor rate = 11.072963 GFLOP / .520896 ms = 21.2575 TFLOP/s.
  The elapsed-clock sustained dense peak from the same NCU report is
  195.853655 TFLOP/s. Their ratio is 10.853783%. Do not substitute
  advertised 2:4 sparse, FP8, or a different clock's peak.
- The two dense-prefix CTAs each visit 96 KV blocks; the other94 visit12.
  Equal-time-per-KV-block approximation gives
  (2*96+94*12)/(110*96)=12.5% time-averaged SM coverage. Startup/epilogue
  and variable iteration cost explain why this is not the measured13.79%.
- gpu__dram_throughput.avg.pct_of_peak_sustained_elapsed = 1.52677% is
  NCU's aggregate DRAM throughput metric, not a byte-count ratio.
  The byte counters report 9479168 DRAM read bytes and0 DRAM write bytes
  during the measured interval, 18.1978 GB/s and1.41979% of sustained read
  peak. Zero DRAM writes does not mean no output stores: output can remain
  in L2 within the measurement window. TMA read traffic is89653248 bytes;
  it is NOT DRAM traffic. L2 hit rate86.49%, L2 throughput3.76%.

## Six dimensions and diagnosis

1. Occupancy: C5 uses239 registers/thread and99456 shared bytes/CTA;
   one256-thread block/SM, active-cycle warp occupancy16.54%. No local
   load/store spill instructions. More CTAs are needed to use idle SMs;
   rearranging the same96 CTAs cannot create that work.
2. Balance: prefix counts range12..96, mean13.75. Maximum SM active
   cycles/mean=7.221; min SM active cycles=0. Random H1 has the same96 CTAs
   but counts2..16, mean9.427, max/mean1.823 and53.81% busy. This isolates
   severe prefix imbalance from grid size alone.
3. Source stalls: prefix C5 QK MMA line739 has1517 math-pipe-throttle and
   735 wait samples; PV MMA line766 has1303 math-pipe and202 wait samples.
   These are sample counts, not wall-time percentages. They show busy
   warps stress tensor computation, even while most of the chip is idle.
4. Tensor work: both kernels execute11.073 GFLOP for H1 prefix; C5's
   active-cycle TC utilization78.69% is already substantial, while
   elapsed-clock SoL is only10.85%. Parallelism is the first priority.
5. Timeline: PM samples retained; the prefix action has a concentrated
   initial interval and a long low-utilization tail. Cross-check with
   the per-SM active-cycle imbalance above. ASCII plots use normalized
   sample position, not a shared wall-time axis.
6. Memory: low DRAM and L2 throughput do not support a bandwidth limit.
   Global memory latency is not ruled out solely by low bandwidth, but
   the grid/work imbalance provides a direct, measured explanation.

## Experiment

Partition each selected KV list into2/4/8/16 disjoint ranges. Preserve each
128x128 Q/KV tile and exact selections. Compute normalized partial outputs
and lnLSE in FP32; combine using stable logsumexp weights and round to BF16
only once. Measure total producer+merge and metadata-inclusive paths.
All-empty partitions must produce0/-inf. Keep C5 as default: random,
single-block, empty, and higher-head workloads may regress from extra Q
loads, scratch traffic, repeated CTA setup and the merge kernel.
