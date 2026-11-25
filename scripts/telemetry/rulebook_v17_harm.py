"""Harm measures for every contact in h/<rec>.json, from the recording: places lost, speed dip, did the car carry on."""
import sys,json,os,bisect,collections
import gmtel, race_bundles as rb
rec=os.path.basename(path).replace('.gmtel.gz','')   # path, H: given by rulebook_v17 (this file is exec'd, not imported)
s=(SESS if globals().get("SESS") is not None else gmtel.Session(path)); frames=(FRAMES if globals().get("FRAMES") is not None else rb.frames_of(s))
L=s.info.get('track_length',0) or 5000
TS=collections.defaultdict(list)
for t,cars in frames:
    for i,c in cars.items(): TS[i].append((t,c[4],c[10],c[11],c[12],c[9]))
TT={i:[r[0] for r in v] for i,v in TS.items()}
def row(i,t):
    v=TS.get(i)
    if not v: return None
    k=min(max(bisect.bisect_left(TT[i],t),0),len(v)-1); return v[k]
def dist(r): return r[3]*L+r[2]
END=max(TT[i][-1] for i in TT)
def feats(i,t):
    r0=row(i,t-1.0); r1=row(i,t+6.0); rc=row(i,t-0.2)
    if not r0 or not rc: return None
    v=TS[i]; k0=bisect.bisect_left(TT[i],t); k1=bisect.bisect_left(TT[i],t+4)
    vmin=min((r[1] for r in v[k0:k1]),default=rc[1])
    # time to cover the next 300 m (None = never did: stopped / retired / recording ended)
    m0=dist(rc); e=next((r[0] for r in v[k0:] if dist(r)>=m0+300),None)
    retired = (TT[i][-1] < END-20) and (TT[i][-1]-t < 60)
    # field: other cars that were within 2 s around this spot: their time over the same 300 m
    return {'pos0':r0[4],'pos6':r1[4] if r1 else None,'v0':round(rc[1]),'vmin4':round(vmin),
            't300':None if e is None else round(e-rc[0],2),'retired':retired,'last_t':round(TT[i][-1],1)}
h=H
out=[]
for inc in h:
    P=[]
    for p in inc.get('raw',[]):
        for m in p['ms']:
            P.append({'a':p['a'],'b':p['b'],'t':m['t'],str(p['a']):feats(p['a'],m['t']),str(p['b']):feats(p['b'],m['t'])})
    out.append(P)
