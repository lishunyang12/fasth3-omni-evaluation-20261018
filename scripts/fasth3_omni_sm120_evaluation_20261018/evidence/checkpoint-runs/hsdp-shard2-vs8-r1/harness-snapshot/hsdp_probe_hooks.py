"""Opt-in timing of FSDP weight readiness on the compute stream.

Records events without per-layer or per-step synchronization. The reported
pre-forward interval includes exposed all-gather wait and weight copy-out;
it is not a full-request counterfactual for an unsharded model.
"""
import functools
import json
import os
from pathlib import Path
import time


def install():
    destination = os.environ.get('FASTH3_RUN_DIR')
    if not destination:
        return
    import torch
    import torch.distributed as dist
    from torch.distributed.fsdp._fully_shard._fsdp_param_group import FSDPParamGroup
    from vllm_omni.diffusion.models.minimax_h3.pipeline_minimax_h3 import MiniMaxH3Pipeline
    if getattr(FSDPParamGroup, '_hsdp_latency_probe', False):
        return
    root = Path(destination)
    state = dict(name=None, enabled=False, step=-1, records=[])

    def event():
        result = torch.cuda.Event(enable_timing=True)
        result.record()
        return result

    pre_forward = FSDPParamGroup.pre_forward
    post_forward = FSDPParamGroup.post_forward

    @functools.wraps(pre_forward)
    def pre(self, module, args, kwargs):
        fqn = self._module_fqn
        if fqn == '':
            cfg = json.loads((root / 'control.json').read_text())
            if cfg['name'] != state['name']:
                state.update(name=cfg['name'], enabled=cfg.get('profile_hsdp', False),
                             step=-1, records=[])
            state['step'] += 1
        if not state['enabled']:
            return pre_forward(self, module, args, kwargs)
        start = event()
        cpu_start = time.perf_counter()
        result = pre_forward(self, module, args, kwargs)
        cpu_ms = (time.perf_counter() - cpu_start) * 1000
        end = event()
        state['records'].append(dict(phase='pre', fqn=fqn, step=state['step'],
                                     events=(start, end), cpu_ms=cpu_ms))
        return result

    @functools.wraps(post_forward)
    def post(self, module, input, output):
        if not state['enabled']:
            return post_forward(self, module, input, output)
        start = event()
        cpu_start = time.perf_counter()
        result = post_forward(self, module, input, output)
        cpu_ms = (time.perf_counter() - cpu_start) * 1000
        end = event()
        state['records'].append(dict(phase='post', fqn=self._module_fqn, step=state['step'],
                                     events=(start, end), cpu_ms=cpu_ms))
        return result

    FSDPParamGroup.pre_forward = pre
    FSDPParamGroup.post_forward = post
    unpack = MiniMaxH3Pipeline._unpack_denoised_rows

    @functools.wraps(unpack)
    def flush(self, *args, **kwargs):
        result = unpack(self, *args, **kwargs)
        if state['enabled'] and state['records']:
            torch.cuda.synchronize()
            records = state['records']
            for record in records:
                start, end = record.pop('events')
                record['gpu_ms'] = start.elapsed_time(end)
            rank = dist.get_rank()
            folder = root / state['name']
            folder.mkdir(parents=True, exist_ok=True)
            payload = dict(rank=rank, records=records,
                           memory_allocated=torch.cuda.memory_allocated(),
                           memory_reserved=torch.cuda.memory_reserved(),
                           max_memory_allocated=torch.cuda.max_memory_allocated(),
                           max_memory_reserved=torch.cuda.max_memory_reserved(),
                           description='Compute-stream pre-forward wait+copy-out and post-forward events; not no-HSDP E2E delta')
            (folder / f'rank{rank}-hsdp.json').write_text(json.dumps(payload, indent=2) + '\n')
            state['records'] = []
        return result

    MiniMaxH3Pipeline._unpack_denoised_rows = flush
    FSDPParamGroup._hsdp_latency_probe = True
    print(f'HSDP_LATENCY_PROBE_INSTALLED pid={os.getpid()}', flush=True)
