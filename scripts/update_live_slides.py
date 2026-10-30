"""Publish a reviewed slide release to the permanent online presentation URL.

Run this after staging a new release, before committing and pushing the site.
The online URL stays fixed; existing viewers check latest.json every 30 seconds.
"""
import argparse
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
DECK = ROOT / 'slides/minimax-h3-real-time-inference-20261025'


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(4 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


class Slides(HTMLParser):
    def __init__(self):
        super().__init__()
        self.current = None
        self.slides = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'figure' and re.fullmatch(r'slide-\d+', attrs.get('id', '')):
            self.current = int(attrs['id'].split('-')[1])
        if tag == 'img' and self.current is not None:
            self.slides.append(dict(number=self.current, title=re.sub(r'^Slide \d+:\s*', '', attrs['alt']),
                                    image=attrs['src']))

    def handle_endtag(self, tag):
        if tag == 'figure':
            self.current = None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', help='Reviewed version, such as v1.38; defaults to newest stable release.')
    parser.add_argument('--check', action='store_true', help='Verify the online pointer matches the newest reviewed release.')
    args = parser.parse_args()
    releases = []
    for folder in DECK.iterdir():
        match = re.fullmatch(r'v(\d+)\.(\d+)(?:\.(\d+))?', folder.name)
        manifest = folder / 'release-manifest.json'
        if not match or not manifest.is_file():
            continue
        data = json.loads(manifest.read_text())
        if data.get('validation', {}).get('status', '').startswith('pass') and data.get('publication', '').startswith('public'):
            releases.append((tuple(int(x or 0) for x in match.groups()), folder, data))
    if not releases:
        raise ValueError('No reviewed public slide release is available')
    releases.sort(key=lambda r:r[0], reverse=True)
    if args.release:
        selected = next((r for r in releases if r[1].name == args.release), None)
        if selected is None:
            raise ValueError('Requested release is not a reviewed public stable release')
    else:
        selected = releases[0]
    _, folder, manifest = selected
    version = folder.name
    files = {}
    for kind in ('pptx', 'pdf'):
        candidates = list(folder.glob('*.'+kind))
        if len(candidates) != 1 or sha(candidates[0]) != manifest[kind+'_sha256']:
            raise ValueError('Release '+kind+' does not match the reviewed manifest')
        files[kind] = str(candidates[0].relative_to(DECK))
    parsed = Slides()
    parsed.feed((folder/'index.html').read_text())
    if [r['number'] for r in parsed.slides] != list(range(1, manifest['slides']+1)):
        raise ValueError('Preview is missing slides or slide titles')
    for slide in parsed.slides:
        image = folder/slide['image']
        slide.update(image=str(image.relative_to(DECK)), sha256=sha(image), hidden=slide['number'] in manifest.get('hidden_slides', []))
    recording_path = folder/'demo-recording.json'
    if recording_path.is_file():
        recording = json.loads(recording_path.read_text())
        video = folder/recording['video']
        if sha(video) != recording['sha256']:
            raise ValueError('Demo recording does not match its reviewed manifest')
        slide = parsed.slides[recording['slide']-1]
        slide.update(video=str(video.relative_to(DECK)), video_sha256=recording['sha256'],
                     poster=str((folder/recording['poster']).relative_to(DECK)))
    roles = manifest.get('slide_roles', {})
    baseline_number = roles.get('baseline', 6)
    quality_number = roles.get('quality', 11)
    overview_number = roles.get('overview', 12)
    ladder_number = roles.get('ladder', 18)
    demo_slides = roles.get('demo_setup', [7] + [s['number'] for s in parsed.slides if s['title'].startswith('Live Avatar:') and 'Recorded' not in s['title']])
    related = []
    for name, label, numbers in [('model-comparison.html', 'Model comparison and official sources', [roles['model_comparison']] if 'model_comparison' in roles else []),
                                  ('topology-bandwidth.html', 'Bandwidth encoding and evidence', [roles['bandwidth_topology']] if 'bandwidth_topology' in roles else []),
                                  ('baseline-breakdown.html', 'Baseline config and measured costs', [baseline_number]),
                                  ('latency-breakdown.html', 'Current breakdown and GPU work', [baseline_number]),
                                  ('continuous-generation.html', 'Five-second generation timeline', demo_slides),
                                  ('four-videos.html', f'Play slide {quality_number} videos', [quality_number]),
                                  ('benchmarks.html', f'Slide {ladder_number} measured optimization ladder', [ladder_number]),
                                  ('demo-config.html', 'Live demo pipeline and setup', demo_slides),
                                  ('continuation.html', 'How avatar continuation works', [roles['continuation']] if 'continuation' in roles else []),
                                  ('takeaways.html', 'Key takeaways and next steps', [roles['takeaways']] if 'takeaways' in roles else []),
                                  ('creators.html', 'Creator workflows and community', roles.get('creators', []) + ([roles['community']] if 'community' in roles else [])),
                                  ('demo-video.html', 'Play or download the recorded demo', [recording['slide']] if recording_path.is_file() else [])]:
        if (folder/name).is_file():
            related.append(dict(label=label, url=f'{version}/{name}', slides=numbers))
    if manifest.get('baseline_profile_url') and not (folder/'baseline-breakdown.html').is_file():
        related.append(dict(label='Baseline configuration and historical profile',
                            url=manifest['baseline_profile_url'], slides=[baseline_number]))
    if manifest.get('quality_video_url') and not (folder/'four-videos.html').is_file():
        related.append(dict(label='Prior quantization quality videos', url=manifest['quality_video_url'], slides=[quality_number]))
    if manifest.get('historical_continuity_url') and not (folder/'continuous-generation.html').is_file():
        related.append(dict(label='Historical AAS / Rolling RoPE study', url=manifest['historical_continuity_url'], slides=[overview_number]))
    if (folder/'continuous-generation.html').is_file():
        related.append(dict(label='AAS / Rolling RoPE archive', url='../../reports/h3-liveavatar-long-video-20261014/long/', slides=demo_slides+[overview_number]))
    payload = dict(schema_version=1, title=parsed.slides[0]['title'], version=version,
                   slides=parsed.slides, downloads=files, release_url=f'{version}/', related=related,
                   profile_url='../../profiles/slide18-final-20261027/',
                   history=[dict(label=f'{f.name} · archived release',url=f'{f.name}/') for _,f,_ in releases]
                        + [dict(label='v1.37 · benchmarks pending',url='v1.37-pending/'),
                           dict(label='v1.36 · historical edition',url='historical-v1.36.html')])
    payload['revision'] = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    target = DECK/'latest.json'
    old = json.loads(target.read_text()) if target.exists() else {}
    if args.check:
        if {k:v for k,v in old.items() if k!='updated_at_utc'} != payload:
            raise SystemExit('Live presentation needs updating: python3 scripts/update_live_slides.py')
    elif old.get('revision') != payload['revision']:
        payload['updated_at_utc'] = datetime.now(timezone.utc).isoformat()
        target.write_text(json.dumps(payload, indent=2, ensure_ascii=False)+'\n')
    print(json.dumps(dict(version=version, slides=len(parsed.slides), revision=payload['revision'],
                          stable_url='https://lishunyang12.github.io/fasth3-omni-evaluation-20261018/slides/minimax-h3-real-time-inference-20261025/')))


if __name__ == '__main__':
    main()
