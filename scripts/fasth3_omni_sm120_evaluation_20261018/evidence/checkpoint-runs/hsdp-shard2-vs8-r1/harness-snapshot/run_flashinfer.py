"""FlashInfer deployment overlay; uses the upstream FastVideo helpers, without the custom SM120 kernel."""
import os,sys
from pathlib import Path
R=Path('$WORKSPACE');A=R/'fasth3-omni-integration-20261018'
env=os.environ.copy()
env.update(PYTHONPATH=':'.join(map(str,[A/'runtime-packages',R/'vllm-omni-fasth3-omni',R/'minimax-h3-native/FastVideo/fastvideo-kernel/python',R/'flashinfer-pr4859'])),PYTHONDONTWRITEBYTECODE='1',OMP_NUM_THREADS='2',TRITON_CACHE_DIR=str(A/'triton-sm120-cache'),TORCHINDUCTOR_CACHE_DIR=str(A/'inductor-cache'),FLASHINFER_WORKSPACE_BASE=str(A/'flashinfer-probe-cache'),FLASH_ATTENTION_CUTE_DSL_CACHE_DIR=str(A/'flashinfer-probe-cache/cute'))
os.execvpe(sys.argv[1],sys.argv[1:],env)
