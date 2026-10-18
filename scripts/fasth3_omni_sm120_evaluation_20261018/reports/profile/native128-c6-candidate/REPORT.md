# First C6 prototype: split-KV with direct FP32 stores

Archived experiment, superseded by native128-c6b-candidate. Original source
and harness are retained here. All12 actions (three inputs times C5,
split8 producer, split8 merge, FI64) have full+PM+source profiles and
ncu_report/KDA analysis. Inputs match the C6 baseline, seed80513.

H1 prefix: C5 .520768ms; split8 producer .190048ms and independently
cold-replayed merge .061376ms; FI .364192ms. The producer retains exactly
11.072963 GFLOP and physical128 tiles. Its SM busy rises13.83%->71.13%,
but active-cycle tensor utilization falls to41.97% and dense SoL29.85%.
NCU durations for separate cold-cache kernels must not be substituted for
hot producer+merge latency; validation-v4/train.json times the full chain.

The first implementation passed180 split configurations across45 adversarial
cases, but exposed a new bottleneck. Register allocation reaches255/thread;
337920 local-load and196608 local-store instructions execute in H1 prefix.
The corresponding C5 counters are0. Direct FP32 output addressing extends
register lifetimes; this is an evidence-based reason to change the epilogue.

Six dimensions: (1) one CTA/SM,99456 shared bytes, register pressure255;
(2) grid96->768 and max-active/mean7.22->1.415 improve balance;
(3) source reports show added global/local-memory stalls around output and
MMA, rather than only original math-pipe stalls; (4) identical tensor work,
more startup/output overhead per KV tile and lower active-cycle TC rate;
(5) PM reports retain the shortened sparse tail and more sustained active
work; (6) producer DRAM13.15%, L233.53%; merge DRAM70.10%, L235.05%,
L2 hit2.37% in its isolated cold replay. Scratch traffic and a second kernel
remain real costs even after removing spills.

Next experiment: reuse consumed K/V shared storage for FP32 output staging,
with barriers before reuse and before global stores. Preserve the FP32
partial-output contract and measure complete-chain latency. This became C6b.
