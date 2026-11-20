"""Rulebook v1.6 (GreMi, interview rounds 1-5 and F1-F7, 19-20 Nov 2026; approved 20 Nov 2026).

Ported from the rulebook thread's judge (project file rulebook-v16/v16.py) without changing a rule.
verdicts.judge_all() runs it on every incident after the v1.5 rules: the v1.5 calls stay only for
contacts with AI cars (R6). Each car pair in an incident is measured against the field (braking
zones, braking point and pressure, racing line, moves towards the other car over the whole
incident, wheels off, time lost) and judged:

  1. Rejoining the track into another car that lost time: the rejoining car (sev 4/5/6 by time lost).
  2. Nobody lost 1.0 s (lap 1) / 0.5 s or went off, and nothing reckless: not an incident (R1).
  3. The car behind braking late (30%+ later than the field, 20%+ later than its own laps), softly
     closing in, or off the racing line slowing too little: at fault (sev 2-8).
  4. Moving towards a car that held its line (before the touch, or kept coming after it while the
     other car was pushed off or lost time): at fault (sev 2-8, higher when pushed off / fast).
  5. Otherwise the car behind running into the car ahead without overlap (sev 2), not when the
     car ahead was just hit by someone else, nor on lap 1 with normal braking.
  Braking hard to avoid it: one less. Wet: one less.
"""
import math
import statistics as st

CAR_LEN = 5.6


def judge_incidents(j, incs, name=str):
    """v1.6 verdicts for every incident (same shape as verdicts.Judge.judge)."""
    S = {}
    for t, c in j.frames:
        for i, r in c.items():
            S.setdefault(i, []).append((t, r))
    tl,ai=j.track_len,j.ai
    at=j.at; lapm=lambda r:r[11]*tl+r[10]
    BIN=5
    prof={}
    for i,s in S.items():
        if i in ai: continue
        for t,r in s:
            if r[11]>=2 and r[4]>20: prof.setdefault(int(r[10]//BIN),[]).append(r)
    def pm(b,k):
        x=prof.get(b); return st.median(q[k] for q in x) if x else None
    nb=int(tl//BIN)+1
    def zone_at(end):
        s=end
        while True:
            v=pm((s-1)%nb,6)
            if v is None or v<0.3: break
            s-=1
        e=end
        while True:
            v=pm((e+1)%nb,6)
            if v is None or v<0.3: break
            e+=1
        return s,e
    def zone_before(d):
        """the field's braking zone that ends nearest before/at d (+40 m), skipping short dabs (rotation): (start, end, apex) m"""
        k=int(d//BIN)+8
        for _ in range(80):
            v=pm(k%nb,6)
            if v is not None and v>=0.3:
                s,e=zone_at(k)
                if (e-s+1)*BIN>=15:
                    ap=min(range(e,e+40),key=lambda q:pm(q%nb,4) if pm(q%nb,4) is not None else 999)
                    return s*BIN,(e+1)*BIN,ap*BIN
                k=s-1; continue
            k-=1
        return None
    def line(dd):
        x=prof.get(int(dd//BIN)%nb)
        if not x: return None
        return (st.median(q[0] for q in x), st.median(q[1] for q in x))
    def lat(r):
        """metres from the field's racing line (median path of all cars, laps 2+), + = one side"""
        dd=r[10]; L=line(dd); a,b=line(dd-5),line(dd+5)
        if not L or not a or not b: return None
        dx,dz=b[0]-a[0],b[1]-a[1]; n=math.hypot(dx,dz) or 1
        return (dx*(r[1]-L[1])-dz*(r[0]-L[0]))/n
    _BC={}
    def brake_of(i,lap,z):
        k=(i,lap,z)
        if k not in _BC: _BC[k]=_brake_of(i,lap,z)
        return _BC[k]
    def _brake_of(i,lap,z):
        s,e,ap=z
        g=[(t,r) for t,r in S.get(i,[]) if r[11]==lap and s-150<=r[10]<=ap+20]
        on=None
        for k,(t,r) in enumerate(g):
            if r[6]>=0.3:
                hold=[q for tt,q in g[k:] if tt<=t+0.2]
                if all(q[6]>=0.2 for q in hold): on=(t,r); break
        if not on: return None
        z_=[r for t,r in g if r[10]>=on[1][10] and r[10]<=ap]
        dur=sum(1 for t,r in g if r[6]>=0.2)
        apx=min((r for t,r in g if abs(r[10]-ap)<=40),key=lambda r:r[4],default=None)
        sp0=on[1][4]; d0=on[1][10]
        s40=next((r[4] for t,r in g if r[10]>=d0+40),None)
        off=lat(on[1])
        return {'decel40':round(sp0-s40) if s40 is not None else None,'off_line_m':round(abs(off),1) if off is not None else None,'at':round(on[1][10]),'t':on[0],'max':round(max(r[6] for r in z_),2) if z_ else None,'avg':round(st.mean(r[6] for r in z_),2) if z_ else None,
                'entry_kmh':round(on[1][4]),'apex_kmh':round(apx[4]) if apx else None}
    _RC={}
    def ref(z,lap_filter,excl=(),key=None):
        k=(z,key,tuple(excl))
        if key and k in _RC: return _RC[k]
        r=_ref(z,lap_filter,excl)
        if key: _RC[k]=r
        return r
    def _ref(z,lap_filter,excl=()):
        ons,maxs,apx,ent=[],[],[],[]
        for i,s in S.items():
            if i in ai or i in excl: continue
            for L in sorted({r[11] for _,r in s}):
                if not lap_filter(L): continue
                b=brake_of(i,L,z)
                if b: ons.append(b['at']);maxs.append(b['max'] or 0);apx.append(b['apex_kmh'] or 0);ent.append(b['entry_kmh'])
        if not ons: return None
        return {'brake_at':round(st.median(ons)),'max':round(st.median(maxs),2),'apex_kmh':round(st.median(apx)),'entry_kmh':round(st.median(ent)),'n':len(ons)}
    def track_for(a,b,t):
        A,B=at(t)[a],at(t)[b];mid=((A[0]+B[0])/2,(A[1]+B[1])/2)
        for i in (a,b):
            if i in j.race.arr:
                tr=j.race.track(i,t-4,t+4,mid,70)
                if tr: return tr
    def own_lost(i,t,lap):
        R=at(t)[i];d0=R[10]
        def dur(L):
            g=[(tt,r) for tt,r in S[i] if (r[11]==L and r[10]>=d0) or r[11]==L+1]
            if not g: return None
            t0=g[0][0];m0=lapm(g[0][1]);e=next((tt for tt,r in g if lapm(r)>=m0+300),None)
            return e-t0 if e else None
        me=dur(lap);o=[x for x in (dur(L) for L in range(2,9) if L!=lap) if x]
        return round(me-st.median(o),1) if me and o else None
    def measure(inc,c):
        if True:
            a,b,t=c['a'],c['b'],c['t']
            if a in ai or b in ai: return None
            A=at(t)[a];d=(A[10]+at(t)[b][10])/2;lap=A[11]
            z=zone_before(d);tr=track_for(a,b,t)
            front,back=(a,b) if lapm(at(t-0.3)[a])>lapm(at(t-0.3)[b]) else (b,a)
            x={'t':round(t,1),'lap':lap,'d':round(d),'gap_m':round(lapm(at(t-0.3)[front])-lapm(at(t-0.3)[back]),1),'front':name(front),'back':name(back)}
            if z:
                s_,e_,ap=z
                x['zone']={'start':s_,'end':e_,'apex':ap}
                x['phase']='braking' if d<ap-30 else 'apex' if d<=ap+30 else 'exit' if d<=ap+150 else 'straight'
                x['field']=ref(z,lambda L:L>=2,key='f2'); x['field_lap1']=ref(z,lambda L:L==1,excl=(a,b),key='l1') if lap==1 else None
            else: x['phase']='no braking zone (straight or flat-out corner)'
            near=[name(i) for i,r in at(t).items() if i not in (a,b) and i not in ai and abs(lapm(r)-lapm(A))<40]
            x['cars_within_40m']=near; x['front_id']=front; x['back_id']=back
            for i,oth in ((a,b),(b,a)):
                y={}
                if z:
                    bb=brake_of(i,lap,z)
                    if bb:
                        y.update({k2:bb[k2] for k2 in ('at','max','avg','entry_kmh','apex_kmh')})
                        f=(x.get('field_lap1') or x['field']) if lap==1 else x['field']; zl=max(z[2]-f['brake_at'],30) if f else None
                        if f: y['late_vs_field_pct']=round(100*(bb['at']-f['brake_at'])/zl)
                        own=[brake_of(i,L,z) for L in range(2,9) if L!=lap]
                        own=[q for q in own if q]
                        if own:
                            oa=st.median(q['at'] for q in own); y['late_vs_own_pct']=round(100*(bb['at']-oa)/max(z[2]-oa,30))
                            dl=[q['decel40'] for q in own if q.get('decel40') is not None]
                            if dl and bb.get('decel40') is not None: y['decel40_kmh']=bb['decel40']; y['own_decel40_kmh']=round(st.median(dl))
                            y['off_line_at_brake_m']=bb.get('off_line_m')
                            y['own_max']=round(st.median(q['max'] or 0 for q in own),2); y['own_apex_kmh']=round(st.median(q['apex_kmh'] or 0 for q in own))
                        tb=bb['t']; y['gap_when_braking']=round(lapm(at(tb)[i])-lapm(at(tb)[oth]),1)
                    else: y['braking']='none in this zone'
                if tr:
                    def off(q,tt): return j.offset(tr,q,tt)[0]
                    o1,o0,oo=off(i,t-1.2),off(i,t-0.1),off(oth,t-0.1)
                    if None not in (o1,o0,oo):
                        side=1 if oo>o0 else -1; y['moved_toward_before_m']=round((o0-o1)*side,1)
                        o2=off(i,t+1.5)
                        if o2 is not None: y['moved_toward_after_m']=round((o2-o0)*side,1)
                    oa_,h=j.offset(tr,i,t-0.1)
                    if oa_ is not None: y['to_white_line_m']=round(h-abs(oa_),1); y['side_of_track']='left' if oa_>0 else 'right'
                    oa2,h2=j.offset(tr,i,t+1.0)
                    if oa2 is not None: y['to_white_line_1s_after_m']=round(h2-abs(oa2),1)
                l1,l0,lo=lat(at(t-1.2)[i]),lat(at(t-0.1)[i]),lat(at(t-0.1)[oth])
                if None not in (l1,l0,lo):
                    side=1 if lo>l0 else -1; y['vs_racing_line_m']=round(l0,1); y['toward_vs_line_before_m']=round((l0-l1)*side,1)
                    l2=lat(at(t+1.5)[i])
                    if l2 is not None: y['toward_vs_line_after_m']=round((l2-l0)*side,1)
                    l3=lat(at(t+3.0)[i])
                    if l3 is not None: y['toward_vs_line_3s_after_m']=round((l3-l0)*side,1)
                # whole incident window: net and largest 1 s move towards the other car (vs racing line)
                ws=[tt/10 for tt in range(int((inc['t0']-1)*10),int((inc['t1']+0.5)*10)+1,2)]
                mv=[]
                for tt in ws:
                    try:
                        p,q=lat(at(tt)[i]),lat(at(tt)[oth])
                    except Exception: p=q=None
                    mv.append((tt,p,q))
                mv=[m for m in mv if m[1] is not None and m[2] is not None]
                if len(mv)>6:
                    sd=lambda m:1 if m[2]>m[1] else -1
                    best=0
                    for a1 in range(len(mv)):
                        for b1 in range(a1+1,len(mv)):
                            if mv[b1][0]-mv[a1][0]>1.0: break
                            best=max(best,(mv[b1][1]-mv[a1][1])*sd(mv[a1]))
                    y['incident_max_1s_toward_m']=round(best,1); y['incident_window']=[round(inc['t0'],1),round(inc['t1'],1)]
                R=at(t-0.1)[i]; y['speed']=round(R[4]); y['brake_now']=round(R[6],2); y['thr_now']=round(R[5],2); y['steer_now']=round(R[7],2)
                y['wheels_off_before']=bin(at(t-0.3)[i][9]).count('1'); y['wheels_off_after']=max(bin(at(t+0.1*q)[i][9]).count('1') for q in range(0,15))
                y['lost_s']=own_lost(i,t,lap)
                x[i]=y
            return x


    def judge_pair(inc,ms,a,b,wet,prior=None):
        """GreMi's v1.6 rulebook (interview rounds 1-5, 19-20 Nov 2026) on all contacts of one car pair in one incident.
        returns {car:(severity, why)} for cars at fault, and a short note"""
        lap=ms[0]['lap']; lim=1.0 if lap==1 else 0.5
        g=lambda x,k,f=max,d=0: f([m[x].get(k) for m in ms if m[x].get(k) is not None] or [d])
        lost={x:g(x,'lost_s') for x in (a,b)}
        off={x:any(m[x].get('wheels_off_after',0)>=2 and m[x].get('wheels_off_before',0)<2 for m in ms) for x in (a,b)}
        rejoin={x:(ms[0][x].get('wheels_off_before',0)>=2 or (ms[0][x].get('to_white_line_m') is not None and ms[0][x]['to_white_line_m']<-1.0)) for x in (a,b)}
        before={x:g(x,'toward_vs_line_before_m') for x in (a,b)}
        after={x:g(x,'toward_vs_line_after_m') for x in (a,b)}
        lost0={x:g(x,'lost_s') for x in (a,b)}
        def kept_coming(x,o):
            """after a touch x kept moving towards o (3-8 m; more is a spin, not a move) while o was pushed away, and o went off or lost time"""
            hit=any(m[o].get('wheels_off_after',0)>=2 for m in ms) or lost0[o]>=(1.0 if lap==1 else 0.5)
            return hit and any(3<=(m[x].get('toward_vs_line_after_m') or 0)<=8 and (m[o].get('toward_vs_line_after_m') or 0)<=(m[x].get('toward_vs_line_after_m') or 0)-2 for m in ms)
        move={x:max(before[x], after[x] if kept_coming(x,b if x==a else a) else 0) for x in (a,b)}
        swerve={x:before[x] for x in (a,b)}
        speed={x:g(x,'speed') for x in (a,b)}
        m0=ms[0]; zone=m0.get('zone'); back=m0['back_id']; front=m0['front_id']
        def late(x):
            y=m0[x]
            if 'late_vs_field_pct' not in y: return 0,None
            lf=y['late_vs_field_pct']; lo=y.get('late_vs_own_pct') if lap!=1 else None
            if lf>=30: return lf,f"braked {lf}% later than the field"
            if lo is not None and lo>=20: return lo,f"braked {lo}% later than on his own laps"
            if (y.get('max') or 1)<0.6 and y.get('gap_when_braking') is not None and -30<y['gap_when_braking']<0: return 25,f"braked softly (max {round(100*y['max'])}%) closing on the car ahead"
            if (y.get('off_line_at_brake_m') or 0)>3 and y.get('own_decel40_kmh') and y.get('decel40_kmh') is not None and y['decel40_kmh']<0.7*y['own_decel40_kmh']:
                return 20,f"braked {y['off_line_at_brake_m']} m off the racing line and slowed {y['decel40_kmh']} km/h in 40 m (own laps {y['own_decel40_kmh']})"
            return 0,None
        hurt=any(lost[x]>=lim or off[x] for x in (a,b))
        out={}
        # 1. rejoining is always the rejoiner's responsibility
        rj=[x for x in (a,b) if rejoin[x]]
        if len(rj)==1:
            x=rj[0]; o=b if x==a else a
            if not hurt: return {},'nothing (rejoin, nobody lost time)'
            s=4 if lost[o]<3 else 5 if lost[o]<10 else 6
            return {x:(s,f"rejoined the track into the other car (it lost {lost[o]:.1f} s)")},''
        lt={x:late(x) for x in (a,b)}
        reckless=any(lt[x][0]>=50 for x in (a,b)) or any(swerve[x]>=5 and speed[x]>250 and abs(m0['gap_m'])<CAR_LEN for x in (a,b))
        if not hurt and not reckless:
            return {},f"nothing: nobody lost {lim:.1f} s or was pushed off"
        # 2. late / soft / off-line braking by the car behind
        if zone and m0['phase'] in ('braking','apex') and lt[back][0]>=20:
            v,why=lt[back]; s=8 if v>=50 else 5 if v>=30 else 3 if v>=25 else 2
            out[back]=(s,why)
        # 3. moving into a car that held its line (whole incident, either car)
        for x,o in ((a,b),(b,a)):
            if (move[x]>=1.0 and move[o]<0.5) or (move[x]>=1.5 and move[x]>=move[o]+1.0) or (before[x]>=1.5 and before[o]>=1.5 and abs(before[x]-before[o])<1.0):
                # severity calibrated on GreMi's own severities in rounds 3-5 (toni 1.4 m = 4, Stepino 2.7 m = 3, Jakub 3.7 m + off = 4, jason 4.9 m = 5)
                s=2 if move[x]<1.5 else 3 if move[x]<4.5 else 5
                if s<5 and (off[o] or lost[o]>=3): s+=1
                if s>=5 and speed[x]>250: s=6
                if swerve[x]>=5 and speed[x]>250 and abs(m0['gap_m'])<CAR_LEN: s=8
                gb=m0[x].get('gap_when_braking')
                if x==back and zone and m0['gap_m']>CAR_LEN and move[x]>=3 and s<5: s=5   # dive without overlap that hits
                why=f"moved {move[x]:.1f} m towards the other car" + (" and pushed it off the track" if off[o] else "")
                if x in out: s=max(s,out[x][0]); why=out[x][1]+"; "+why
                out[x]=(s,why)
        # 4. nobody moved, nobody braked late: hitting the car ahead without overlap
        if not out:
            gap=m0['gap_m']
            y=m0[back]
            normal=y.get('own_decel40_kmh') is None or (y.get('decel40_kmh') or 0)>=0.9*y['own_decel40_kmh']
            crash_ahead=any(m0['t']-2.0<=tt<m0['t'] for tt in (prior or {}).get(front,[]))   # G4: the car ahead was just hit by someone else
            if gap>CAR_LEN and not crash_ahead and not (lap==1 and normal and lost[front]<lim*2):
                out[back]=(2,"ran into the car ahead")
        # trying to avoid it / wet
        for x,(s,why) in list(out.items()):
            y=m0[x]
            if y.get('own_decel40_kmh') and (y.get('decel40_kmh') or 0)>=1.3*y['own_decel40_kmh'] and s>2: s-=1; why+="; braked hard to avoid it"
            if wet and s>1: s-=1
            out[x]=(max(1,s),why)
        return out,'racing incident' if not out else ''


    res = []
    for inc in incs:
        ms = {}
        for c in inc["contacts"]:
            try:
                m = measure(inc, c)
            except Exception:
                m = None
            if m:
                ms.setdefault(frozenset((c["a"], c["b"])), []).append((c, m))
        wet = (j.weather_at(inc["t0"]) or 0) >= 3
        fault, notes, contacts = {}, [], []
        for pair, lst in ms.items():
            a, b = sorted(pair)
            prior = {}
            for c in inc["contacts"]:
                if frozenset((c["a"], c["b"])) != pair:
                    for q in (c["a"], c["b"]):
                        prior.setdefault(q, []).append(c["t"])
            try:
                o, note = judge_pair(inc, [m for c, m in lst], a, b, wet, prior)
            except Exception as ex:
                o, note = {}, "not judged: %s" % ex
            for x, (s, why) in o.items():
                if x not in fault or s > fault[x][0]:
                    fault[x] = (s, why)
            c0 = lst[0][0]
            if o:
                for x, (s, why) in o.items():
                    contacts.append({"a": a, "b": b, "t": c0["t"], "rule": "V16", "severity": s, "verdict": name(x) + " at fault",
                                     "why": name(x) + " " + why, "at_fault": x, "at_fault_all": [x]})
            else:
                r1 = note.startswith("nothing")
                contacts.append({"a": a, "b": b, "t": c0["t"], "rule": "R1" if r1 else "V16", "severity": 1,
                                 "verdict": "Not an incident" if r1 else "Racing incident", "why": note, "at_fault": None, "at_fault_all": []})
            notes.append(note)
        sev = max([s for s, _ in fault.values()] or [1])
        rule = "V16" if fault else ("R1" if all(n.startswith("nothing") for n in notes) else "V16")
        verdict = (" + ".join(name(x) for x in fault) + " at fault") if fault else ("Not an incident" if rule == "R1" else "Racing incident")
        why = "; ".join(name(x) + " " + w for x, (s, w) in fault.items()) or (notes[0] if notes else "no contact between drivers")
        cars = sorted(fault)
        if not contacts:
            c = inc["contacts"][0]
            contacts = [{"a": c["a"], "b": c["b"], "t": c["t"], "rule": "R6", "severity": 1, "verdict": "AI", "why": "AI car",
                         "at_fault": None, "at_fault_all": []}]
        res.append({"rule": rule, "severity": sev, "verdict": verdict, "why": why, "at_fault": cars[0] if cars else None,
                    "at_fault_all": cars, "contacts": contacts})
    return res
