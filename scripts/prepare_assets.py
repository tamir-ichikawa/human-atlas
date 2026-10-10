"""Convert the unmodified BodyParts3D 4.0 IS-A archive to browser geometry.
All 2,234 source meshes, names, concept IDs and assembly coordinates are retained.
Run with: python scripts/prepare_assets.py <source-directory>
Requires numpy. Source files are listed in README.md.
"""
from pathlib import Path
import csv, gzip, hashlib, json, re, sys, zipfile
from collections import defaultdict, Counter
import numpy as np

sys.stdout.reconfigure(encoding='utf-8')
root = Path(__file__).resolve().parents[1]
src = Path(sys.argv[1]).resolve()
out = root / 'dist/assets'
out.mkdir(parents=True, exist_ok=True)

def table(name):
    return list(csv.DictReader((src / name).open(encoding='utf-8'), delimiter='\t'))

parents = defaultdict(set)
for row in table('isa_inclusion_relation_list.txt'):
    parents[row['child id']].add(row['parent id'])
def ancestry(key, seen=None):
    seen = set() if seen is None else seen
    if key in seen: return seen
    seen.add(key)
    for parent in parents[key]: ancestry(parent, seen)
    return seen

isa, partof = defaultdict(set), defaultdict(set)
for name, dest in [('isa_element_parts.txt', isa), ('partof_element_parts.txt', partof)]:
    for row in table(name): dest[row['concept id']].add(row['element file id'])

definitions = [
    ('heart','心臓','Heart',['FMA7088'],'#ac4f51'),
    ('leftLung','左肺','Left lung',['FMA7310'],'#d39a95'),
    ('rightLung','右肺','Right lung',['FMA7309'],'#d39a95'),
    ('liver','肝臓','Liver',['FMA7197'],'#965b51'),
    ('stomach','胃','Stomach',['FMA7148'],'#cf9790'),
    ('kidneys','腎臓','Kidneys',['FMA7204','FMA7205'],'#aa685e'),
    ('brain','脳','Brain',['FMA50801'],'#d6aba2'),
]
groups = []
for key, ja, en, ids, color in definitions:
    members = set().union(*(partof[x] | isa[x] for x in ids))
    groups.append(dict(id=key, title=ja, name=en, concepts=ids, color=color, members=sorted(members)))
group_sets = {g['id']: set(g['members']) for g in groups}

systems = {
    'bones': ('骨格', '#e1ccb0'), 'muscles': ('筋肉', '#b97667'),
    'organs': ('臓器', '#b66f68'), 'vessels': ('血管', '#ae6666'),
    'nerves': ('神経', '#d6b45b'), 'other': ('体表・その他', '#d2ad94')
}
chunks = {key: bytearray() for key in systems}
parts = []
all_min = np.full(3, np.inf)
all_max = np.full(3, -np.inf)
archive = src / 'isa_BP3D_4.0_obj_99.zip'
z = zipfile.ZipFile(archive)
files = sorted(n for n in z.namelist() if n.endswith('.obj'))

def members_of(mapping, ids):
    return set().union(*(mapping[x] for x in ids))
skeletal = partof['FMA23881'] | isa['FMA5018']
muscular = isa['FMA5022']
vascular = partof['FMA7161'] | isa['FMA50720'] | isa['FMA50723']
neural = partof['FMA7157'] | isa['FMA65132']
visceral = members_of(partof, ['FMA7152','FMA7158','FMA7159','FMA7160','FMA9668'])
skin = partof['FMA7163'] | isa['FMA7163']

for n, file in enumerate(files):
    text = z.read(file).decode('utf-8')
    meta = {k.strip(): value.strip() for k,value in re.findall(r'^# ([^:\r\n]+):[ \t]*([^\r\n]*)', text, re.M)}
    fid = Path(file).stem
    name = meta.get('English name') or '名称未記載（原典）'
    concept = meta.get('Concept ID','').strip()
    assert not concept or concept.startswith('FMA'), (fid,meta)
    ancestors = ancestry(concept)
    group = next((key for key, ids in group_sets.items() if fid in ids), None)
    if fid in skin: system = 'other'
    elif group: system = 'organs'
    elif fid in skeletal or 'FMA5018' in ancestors: system = 'bones'
    elif fid in muscular or 'FMA5022' in ancestors: system = 'muscles'
    elif fid in neural or 'FMA65132' in ancestors or re.search(r'\b(nerve|ganglion|ganglia)\b',name,re.I): system = 'nerves'
    elif fid in vascular or {'FMA50720','FMA50723'} & ancestors: system = 'vessels'
    elif fid in visceral: system = 'organs'
    else: system = 'other'
    v = np.fromstring(' '.join(re.findall(r'^v (.+)$',text,re.M)),sep=' ',dtype=np.float32).reshape(-1,3)
    # Rigid orientation: source millimetres (x,y,z) -> metres (x,z,-y).
    v = v[:,[0,2,1]].copy() * np.float32(.001)
    v[:,2] *= -1
    lo,hi=v.min(axis=0),v.max(axis=0)
    center=(lo+hi)/2
    v-=center
    all_min=np.minimum(all_min,lo); all_max=np.maximum(all_max,hi)
    normal = np.fromstring(' '.join(re.findall(r'^vn (.+)$',text,re.M)),sep=' ',dtype=np.float32).reshape(-1,3)
    normal=normal[:,[0,2,1]].copy(); normal[:,2]*=-1
    faces = re.findall(r'^f (.+)$',text,re.M)
    indices=[]
    for face in faces:
        polygon = [int(t.split('/')[0])-1 for t in face.split()]
        for j in range(1,len(polygon)-1): indices.extend((polygon[0],polygon[j],polygon[j+1]))
    index=np.asarray(indices,dtype='<u4')
    assert len(normal)==len(v),fid
    assert int(index.max())<len(v),fid
    chunk=chunks[system]
    offset=len(chunk)
    chunk.extend(v.astype('<f4').tobytes())
    chunk.extend(normal.astype('<f4').tobytes())
    chunk.extend(index.tobytes())
    color=next((g['color'] for g in groups if g['id']==group),systems[system][1])
    if system=='vessels' and ('vein' in name.lower() or 'venous' in name.lower()): color='#658592'
    parts.append(dict(id=fid,name=name,sourceNameMissing=not bool(meta.get('English name')),concept=concept,representation=meta.get('Representation ID',''),system=system,group=group,color=color,center=[round(float(x),6) for x in center],size=[round(float(x),6) for x in hi-lo],offset=offset,vertices=len(v),indices=len(index)))
    if (n+1)%400==0: print('Converted',n+1,flush=True)

available={p['id'] for p in parts}
for g in groups: g['members']=[x for x in g['members'] if x in available]
for system,chunk in chunks.items():
    (out/f'{system}.bin.gz').write_bytes(gzip.compress(bytes(chunk),compresslevel=6,mtime=0))
    print(system,len(chunk),'->',(out/f'{system}.bin.gz').stat().st_size)
manifest=dict(version=1,source='BodyParts3D 4.0 IS-A, polygon reduction 99%',archive=archive.name,archiveSha256=hashlib.sha256(archive.read_bytes()).hexdigest(),count=len(parts),bounds=[all_min.tolist(),all_max.tolist()],systems=[dict(id=k,title=v[0],color=v[1],count=sum(p['system']==k for p in parts)) for k,v in systems.items()],groups=groups,parts=parts)
(out/'atlas.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
assert len(parts)==2234 and len(available)==2234
assert all(g['members'] for g in groups)
print('Saved',len(parts),'parts. Bounds:',manifest['bounds'])
print('Groups:',[(g['title'],len(g['members'])) for g in groups])
