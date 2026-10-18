# C4: native128 grouped-schedule profile

Same S=32768,H=14,B=1,D=128 BF16 synthetic VSA workload and original
128-token selections as the C0/FI profile. KDA's `ncu_report` analysis and
raw metrics are in `analysis/`; `harness/` retains a source snapshot.

| Metric | Initial Triton C0 | FI block64 | Native128 C4 |
|---|---:|---:|---:|
| Tensor active, elapsed cycles | 59.97% | 76.89% | 84.66% |
| Registers per thread | 255 | 254 | 241 |
| Achieved warp occupancy | 16.66% | 16.45% | 16.61% |
| Shared memory per CTA, bytes | 99,348 | 50,304 | 99,456 |
| NCU kernel time, ms | 7.621 | 5.950 | 5.403 |

Occupancy did not increase. The improvement is better tensor instruction
scheduling and a shorter scheduling tail, not higher occupancy. C4 uses
TMA plus staggered shared-to-register MMA fragments, retained from the
Apache-licensed FI source and adapted to full 128x128 blocks.

The slowest SM's active cycles are now only 1.22% above the mean, versus
13.99% for C0. PM-sampling plots are retained. L2 hit rate is 88.74%, DRAM
throughput 12.40%, and local-memory spill requests are zero. Thus the final
schedule trades some cache hit rate for substantially more balanced work.
The grid still provides 32.58 CTA waves per SM. Tensor activity at 84.66%
leaves less room for another large gain without a different execution design.

The first source collection lacked CuTe line metadata. It is retained as
evidence of that limitation. A separate source run with `CUTE_DSL_LINEINFO=1`
is in `../native128-c4-source-lines/`; it does not change production compile
settings. Use that run for source-line attribution.

NCU clocks and replay change absolute timing. Performance claims use the
interleaved standalone benchmark, not this table's profiler timings.
See `../../native-sm120-report.md` for acceptance and limitations.
