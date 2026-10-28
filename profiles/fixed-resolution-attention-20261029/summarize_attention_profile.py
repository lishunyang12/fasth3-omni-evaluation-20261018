"""Summarize kernel-level Nsight evidence for profile_attention_components.py."""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re
import sqlite3


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    directory = args.directory
    validation = json.loads((directory/'validation/result.json').read_text())
    assert validation['status'] == 'component_profile_pass'
    database = directory/'attention.sqlite'
    conn = sqlite3.connect('file:'+str(database)+'?mode=ro', uri=True)
    conn.row_factory = sqlite3.Row
    ranges = conn.execute('''SELECT n.start, n.end, n.globalTid,
        COALESCE(n.text, s.value) AS label FROM NVTX_EVENTS n
        LEFT JOIN StringIds s ON s.id=n.textId
        WHERE COALESCE(n.text, s.value) LIKE 'H3.attention.%' ORDER BY n.start''').fetchall()
    assert len(ranges) == 6, f'Expected six ranges, found {len(ranges)}'
    summary = []
    accounted = 0
    for span in ranges:
        match = re.fullmatch(r'H3\.attention\.heads(2|3)\.(reference|previous_output|direct_input_output)\.replays(\d+)', span['label'])
        assert match, span['label']
        heads, variant, replays = int(match[1]), match[2], int(match[3])
        assert replays == validation['replays_per_range']
        kernels = conn.execute('''SELECT k.start,k.end,k.streamId,k.graphNodeId,s.value AS name
            FROM CUPTI_ACTIVITY_KIND_KERNEL k JOIN StringIds s ON s.id=k.shortName
            WHERE k.start >= ? AND k.end <= ? ORDER BY k.start''', (span['start'],span['end'])).fetchall()
        assert kernels and all(k['graphNodeId'] is not None for k in kernels)
        nodes = Counter(k['graphNodeId'] for k in kernels)
        assert set(nodes.values()) == {replays}, 'A captured graph node is missing a replay'
        accounted += len(kernels)
        named = defaultdict(lambda: dict(count=0, total_ns=0))
        for kernel in kernels:
            named[kernel['name']]['count'] += 1
            named[kernel['name']]['total_ns'] += kernel['end']-kernel['start']
        by_name = []
        for name, stats in named.items():
            assert stats['count'] % replays == 0, (name, stats)
            by_name.append(dict(name=name, count=stats['count'],
                kernels_per_replay=stats['count']//replays,
                summed_kernel_ms_per_replay=stats['total_ns']/1e6/replays))
        by_name.sort(key=lambda x:x['summed_kernel_ms_per_replay'], reverse=True)
        launches = conn.execute('''SELECT COUNT(*) FROM CUPTI_ACTIVITY_KIND_RUNTIME r
            JOIN StringIds s ON s.id=r.nameId WHERE r.start >= ? AND r.end <= ?
            AND r.globalTid=? AND s.value LIKE 'cudaGraphLaunch%' ''',
            (span['start'], span['end'], span['globalTid'])).fetchone()[0]
        assert launches == replays, (span['label'], launches)
        summary.append(dict(heads=heads, variant=variant, replays=replays,
            label=span['label'], kernels_per_replay=len(kernels)//replays,
            kernel_count=len(kernels), cuda_graph_launch_count=launches,
            each_captured_graph_node_observed_in_every_replay=True,
            summed_kernel_ms_per_replay=sum(k['end']-k['start'] for k in kernels)/1e6/replays,
            nvtx_envelope_ms_per_replay=(span['end']-span['start'])/1e6/replays,
            by_kernel=by_name))
    all_kernels = conn.execute('SELECT COUNT(*) FROM CUPTI_ACTIVITY_KIND_KERNEL').fetchone()[0]
    assert accounted == all_kernels, (accounted,all_kernels)
    changes = []
    for heads in (2,3):
        rows = {r['variant']:r for r in summary if r['heads']==heads}
        maps = {v:{k['name']:k['kernels_per_replay'] for k in r['by_kernel']} for v,r in rows.items()}
        names = sorted(set().union(*(set(m) for m in maps.values())))
        deltas = [dict(name=name, **{v:m.get(name,0) for v,m in maps.items()}) for name in names]
        changes.append(dict(heads=heads, counts=[r for r in deltas if len({r[v] for v in maps})>1]))
    trace = directory/'attention.nsys-rep'
    warnings = [dict(row) for row in conn.execute(
        'SELECT severity,text,globalPid FROM DIAGNOSTIC_EVENT WHERE severity >= 2')]
    result = dict(status='component_profile_analyzed', validation=validation,
        h3_end_to_end_measured=False, rdma_executed=False,
        interpretation='Kernel counts establish eliminated layout operations. Node-level Nsight timings include profiler overhead and are not formal performance measurements or eight-GPU pipeline bubble measurements.',
        trace=str(trace), trace_sha256=hashlib.sha256(trace.read_bytes()).hexdigest(),
        sqlite=str(database), total_kernels=all_kernels, all_kernels_assigned_to_ranges=True,
        profiler_diagnostics=warnings,
        diagnostics_note='Nsight emits partial-collection warnings for the bounded capture and no-event warnings for guard subprocesses. All six requested NVTX ranges, 120 graph launches and equal replay counts for every captured graph node were verified. This is not a whole-process trace.',
        ranges=summary, changed_kernel_counts=changes)
    (directory/'summary.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:result[k] for k in ('status','total_kernels','changed_kernel_counts')},indent=2))


if __name__ == '__main__': main()
