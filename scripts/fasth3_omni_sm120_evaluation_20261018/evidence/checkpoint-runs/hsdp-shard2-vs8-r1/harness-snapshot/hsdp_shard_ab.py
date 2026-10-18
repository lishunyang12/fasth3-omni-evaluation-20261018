"""Resident HSDP2/8 comparison, with USP8 fixed and no CPU offload."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

BASE = Path('$WORKSPACE')
ART = BASE / 'fasth3-omni-integration-20261018'
VALID = ART / 'framework-validation'
PYTHON = BASE / 'minimax-h3-native/.venv/bin/python'
REPO = BASE / 'vllm-omni-fasth3-omni'


def publish(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def gpu_apps():
    text = subprocess.check_output(
        ['nvidia-smi', '--query-compute-apps=pid,gpu_uuid,used_memory',
         '--format=csv,noheader,nounits'], text=True)
    return [line.strip() for line in text.splitlines() if line.strip()]


def source_identity():
    digest = hashlib.sha256()
    count = 0
    for path in sorted((REPO / 'vllm_omni').rglob('*.py')):
        digest.update(str(path.relative_to(REPO)).encode() + b'\0')
        digest.update(path.read_bytes())
        count += 1
    return {'python_files': count, 'sha256': digest.hexdigest()}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('destination', type=Path)
    parser.add_argument('--runner', type=Path, default=VALID / 'run_checkpoint_hsdp_shards.py')
    parser.add_argument('--cases', type=Path)
    parser.add_argument('--arms', nargs='+', choices=['hsdp2', 'hsdp4', 'hsdp8'], default=['hsdp2', 'hsdp8'])
    args = parser.parse_args()
    destination = args.destination.resolve()
    destination.mkdir(parents=True, exist_ok=False)
    lock = (ART / '.hsdp-latency-ab.lock').open('a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    if gpu_apps():
        raise RuntimeError('GPU compute processes already present; no benchmark launched')
    identity = source_identity()
    cases = [dict(name='fi-124-warmup', provider='fi', mode='benchmark', frames=124)]
    cases += [dict(name=f'fi-124-repeat{i}', provider='fi', mode='benchmark', frames=124)
              for i in range(5)]
    cases += [dict(name='fi-124-qualification', provider='fi', mode='benchmark',
                   frames=124, save_latents=True)]
    if args.cases:
        cases = json.loads(args.cases.read_text())
    publish(destination / 'cases.json', cases)
    publish(destination / 'source-identity.json', identity)
    (destination / 'working-tree.patch').write_bytes(subprocess.check_output(
        ['git', 'diff', '--binary'], cwd=REPO))
    gpu_info = subprocess.check_output(
        ['nvidia-smi', '--query-gpu=index,uuid,name,memory.total,memory.used,utilization.gpu',
         '--format=csv,noheader'], text=True)
    (destination / 'gpu-before.csv').write_text(gpu_info)
    environment = os.environ.copy()
    environment['CUDA_VISIBLE_DEVICES'] = '0,1,2,3,4,5,6,7'
    environment['PATH'] = str(ART / 'media-tools') + os.pathsep + environment['PATH']
    environment['PYTHONDONTWRITEBYTECODE'] = '1'
    status = {'started': time.time(), 'order': args.arms, 'arms': {},
              'source_identity': identity, 'scope': 'TP1 USP8; resident HSDP; only shard/replicate mesh sizes change'}
    publish(destination / 'status.json', status)
    for arm in status['order']:
        if gpu_apps():
            raise RuntimeError('GPU processes remain before next arm; stopped')
        if source_identity() != identity:
            raise RuntimeError('Model source changed; stopped')
        command = [sys.executable, str(VALID / 'run_flashinfer.py'), str(PYTHON),
                   str(args.runner), '--run-dir', str(destination / arm),
                   '--cases', str(destination / 'cases.json'), '--num-gpus', '8',
                   '--tp', '1', '--usp', '8', '--te-tp', '8', '--no-profile']
        command.extend(['--hsdp', '--hsdp-shard-size', arm.removeprefix('hsdp')])
        status['arms'][arm] = {'command': command, 'started': time.time()}
        publish(destination / 'status.json', status)
        print(f'ARM_START {arm}', flush=True)
        with (destination / f'{arm}.log').open('w') as log:
            process = subprocess.Popen(command, env=environment, cwd=REPO,
                                       stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            status['arms'][arm]['pid'] = process.pid
            publish(destination / 'status.json', status)
            try:
                code = process.wait(timeout=2400)
            except BaseException:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
                raise
        status['arms'][arm].update(returncode=code, finished=time.time())
        status['arms'][arm]['source_unchanged'] = source_identity() == identity
        publish(destination / 'status.json', status)
        print(f'ARM_END {arm} returncode={code}', flush=True)
        # Successful workers close naturally; allow their process groups to drain.
        deadline = time.monotonic() + 30
        while gpu_apps() and time.monotonic() < deadline:
            time.sleep(1)
        status['arms'][arm]['gpu_apps_after'] = gpu_apps()
        publish(destination / 'status.json', status)
        if code or not status['arms'][arm]['source_unchanged'] or status['arms'][arm]['gpu_apps_after']:
            raise RuntimeError(f'{arm} arm failed; preserve all evidence and stop')
    status['finished'] = time.time()
    publish(destination / 'status.json', status)


if __name__ == '__main__':
    main()
