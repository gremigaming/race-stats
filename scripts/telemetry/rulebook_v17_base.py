"""Rulebook v1.7 base measures (rulebook thread v17.py, 24 Nov 2026). rulebook_v17.py re-judges every car pair
from the measures this file saves on each incident (inc["_ms"]); its own verdicts are not used.

Original v1.6 notes:
Rulebook v1.6 (GreMi, interview rounds 1-5 and F1-F7, 19-20 Nov 2026; approved 20 Nov 2026).

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
import os
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
    _LN={}
    def lineb(k):
        if k not in _LN:
            pts=[line(j*BIN) for j in range(k-3,k+4)]; pts=[p for p in pts if p]
            _LN[k]=(sum(p[0] for p in pts)/len(pts),sum(p[1] for p in pts)/len(pts)) if pts else None
        return _LN[k]
    def lat(r):
        """metres from the field's racing line (median path of all cars, laps 2+, smoothed), + = one side.
        round 9 (GreMi Madrid Prijo/Toad): the lap distance in a row can lag the position by up to 0.5 s (40 m at 300 km/h),
        so the nearest racing-line segment within 70 m is used instead of the lap-distance bin"""
        if not LAT_NEAREST:
            dd=r[10]; L=line(dd); a,b=line(dd-5),line(dd+5)
            if not L or not a or not b: return None
            dx,dz=b[0]-a[0],b[1]-a[1]; n=math.hypot(dx,dz) or 1
            return (dx*(r[1]-L[1])-dz*(r[0]-L[0]))/n
        k0=int(r[10]//BIN); best=None
        for k in range(k0-14,k0+15):
            a,b=lineb(k%nb),lineb((k+1)%nb)
            if not a or not b: continue
            tx,tz=b[0]-a[0],b[1]-a[1]; tl_=math.hypot(tx,tz) or 1; ux,uz=tx/tl_,tz/tl_
            dx,dz=r[0]-a[0],r[1]-a[1]
            u=max(0,min(tl_,dx*ux+dz*uz)); d=math.hypot(dx-ux*u,dz-uz*u)
            if best is None or d<best[0]: best=(d,(tx*dz-tz*dx)/tl_,tx,tz)
        if best is not None and MAPLINE and MAP is not None and MAP.line is not None:
            # 24 Nov (GreMi): the racing line is the map's dark stripe, not the average of everyone's laps
            dm,km=MAP.to_line(r[0],r[1])
            if dm is not None and dm<40:
                L_=MAP.line; a_=L_[max(km-2,0)]; b_=L_[min(km+2,len(L_)-1)]
                mx,mz=b_[0]-a_[0],b_[1]-a_[1]
                if mx*best[2]+mz*best[3]<0: mx,mz=-mx,-mz
                ml=math.hypot(mx,mz) or 1; dx,dz=r[0]-L_[km][0],r[1]-L_[km][1]
                return (mx*dz-mz*dx)/ml
        return None if best is None else best[1]
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
        me=dur(lap)
        if LAP1_FIELD and lap==1:
            # round 9: lap 1 is slower for everyone, so compare with the other cars over the same 300 m of lap 1
            def dur_c(c):
                g=[(tt,r) for tt,r in S.get(c,[]) if r[11]==1 and r[10]>=d0]
                if not g or abs(g[0][1][10]-d0)>30: return None
                t0=g[0][0];e=next((tt for tt,r in g if r[10]>=d0+300),None)
                return e-t0 if e else None
            gm=[(tt,r) for tt,r in S.get(i,[]) if r[11]==1 and r[10]>=d0]
            tm0=gm[0][0] if gm else None
            def near(c):
                g=[tt for tt,r in S.get(c,[]) if r[11]==1 and r[10]>=d0]
                return tm0 is not None and g and abs(g[0]-tm0)<=3.0
            o=[x for x in (dur_c(c) for c in S if c!=i and near(c)) if x]
            return round(me-st.median(o),1) if me and len(o)>=3 else None
        o=[x for x in (dur(L) for L in range(2,9) if L!=lap) if x]
        return round(me-st.median(o),1) if me and o else None
    def slide(i,t):
        """largest angle (deg) between where the car points and where it goes, 1.0-0.1 s before t"""
        best=0
        for k in range(1,10):
            tt=t-k*0.1
            try:
                p0,p1=at(tt-0.1)[i],at(tt)[i]
            except Exception:
                continue
            dx,dz=p1[0]-p0[0],p1[1]-p0[1]
            if p1[4]<40 or math.hypot(dx,dz)<0.5: continue
            d=math.degrees(math.atan2(dz,dx)-p1[3])
            d=abs((d+180)%360-180)
            best=max(best,d)
        return round(best)
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
            A12=at(t-1.2)
            nearby=[i for i,r in at(t).items() if i not in (a,b) and i not in ai and abs(lapm(r)-lapm(A))<60 and i in A12]
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
                    def off(q,tt):
                        if not EDGEMV: return j.offset(tr,q,tt)[0]
                        # 24 Nov: across the track measured from the track's middle (map white lines), not from one car's old lap
                        c_=at(tt).get(q)
                        if not c_: return None
                        kk_,oo_=j.race.project(tr[0],tr[1],__import__('numpy').array([[c_[0],c_[1]]]))
                        if not len(kk_): return None
                        return float(oo_[0]-(tr[2][kk_[0]]-tr[3][kk_[0]])/2)
                    o1,o0,oo=off(i,t-1.2),off(i,t-0.1),off(oth,t-0.1)
                    if None not in (o1,o0,oo):
                        side=1 if oo>o0 else -1; y['moved_toward_before_m']=round((o0-o1)*side,1)
                        o2=off(i,t+1.5)
                        if o2 is not None: y['moved_toward_after_m']=round((o2-o0)*side,1)
                        # v1.7 round 3: the flow of the cars around (GreMi: judge the line they could drive with the cars around them)
                        fl=[]
                        for k_ in nearby:
                            p1,p0=off(k_,t-1.2),off(k_,t-0.1)
                            if p1 is not None and p0 is not None: fl.append((p0-p1)*side)
                        if fl: y['flow_track_m']=round(st.median(fl),1); y['flow_n']=len(fl)
                    oa_,h=j.offset(tr,i,t-0.1)
                    if oa_ is not None: y['to_white_line_m']=round(h-abs(oa_),1); y['side_of_track']='left' if oa_>0 else 'right'
                    oa2,h2=j.offset(tr,i,t+1.0)
                    if oa2 is not None: y['to_white_line_1s_after_m']=round(h2-abs(oa2),1)
                l1,l0,lo=lat(at(t-1.2)[i]),lat(at(t-0.1)[i]),lat(at(t-0.1)[oth])
                if None not in (l1,l0,lo):
                    side=1 if lo>l0 else -1; y['vs_racing_line_m']=round(l0,1); y['toward_vs_line_before_m']=round((l0-l1)*side,1)
                    fl=[]
                    for k_ in nearby:
                        try:
                            p1,p0=lat(at(t-1.2)[k_]),lat(at(t-0.1)[k_])
                        except Exception:
                            p1=p0=None
                        if p1 is not None and p0 is not None: fl.append((p0-p1)*side)
                    if fl: y['flow_line_m']=round(st.median(fl),1)
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
                y['off_time_before_s']=round(sum(0.1 for q in range(3,23) if bin(at(t-0.1*q)[i][9]).count('1')>=2),1)
                y['wheels_off_before']=bin(at(t-0.3)[i][9]).count('1'); y['wheels_off_after']=max(bin(at(t+0.1*q)[i][9]).count('1') for q in range(0,15))
                y['lost_s']=own_lost(i,t,lap)
                y['slide_deg']=slide(i,t)
                y['closing_kmh']=round(at(t-0.1)[i][4]-at(t-0.1)[oth][4])
                x[i]=y
            return x


    def judge_pair(inc,ms,a,b,wet,prior=None,wake=None):
        """round 4: a pair that touches again 3 s+ later is judged per touch (GreMi: Brazil #91 braked late at the second touch)"""
        groups=[]
        for m in ms:
            if SPLIT and groups and m['t']-groups[-1][-1]['t']>=SPLIT: groups.append([m])
            elif groups: groups[-1].append(m)
            else: groups.append([m])
        out,n0=judge_one(inc,ms,a,b,wet,prior,wake); out=dict(out); notes=[n0]
        for k,g in enumerate(groups[1:],1):
            m=g[0]; bk,fr=m['back_id'],m['front_id']; yb,yf=m[bk],m[fr]
            # round 6 (GreMi: Madrid Senna 7:40 'trying to take K7 out', sev 9): back on the throttle, off the brake,
            # into a car that is braking in a braking zone, closing in, seconds after already hitting it
            if THROTTLE_HIT and m.get('zone') and m.get('phase') in ('braking','apex') and (yb.get('thr_now') or 0)>=0.3 and (yb.get('brake_now') or 0)<=0.05 \
                    and (yf.get('brake_now') or 0)>=0.3 and (yb.get('closing_kmh') or 0)>=15 and m['t']-groups[k-1][-1]['t']<=15:
                out[bk]=(9,f"stayed on the throttle (no brake) into a braking car he had hit {m['t']-groups[k-1][0]['t']:.0f} s earlier: on purpose")
                continue
            # a later touch only adds blame of its own (sev 2+), small follow-up nudges stay part of the first
            o,n=judge_one(inc,g,a,b,wet,prior,wake)
            for x,(sv,why) in o.items():
                gh=any(((g[0][c].get('lost_s') or 0)>=SECOND_HARM or (g[0][c].get('wheels_off_after') or 0)>=2) for c in (a,b))
                if SECOND_MODE==1 and out and sv<4: continue   # round 9 (GreMi R9-17 Madrid, R9-3 Bahrain): the first touch owns it
                if SECOND_MODE==2 and sv<4: continue
                # round 9 (GreMi R9-17 Madrid: 'fully on the Ferrari'): the car that was hit and hurt at the first touch
                # is still recovering a few seconds later, so its moves at the next touch are not new blame
                if SECOND_MODE==3 and sv<4 and x not in out and out and m['t']-groups[0][0]['t']<=6 and (groups[0][0][x].get('lost_s') or 0)>=0.5: continue
                if sv>=2 and (sv>=4 or gh or not SECOND_HARM) and (x not in out or sv>out[x][0]): out[x]=(sv,why+" (second touch)")
        if out: return out,''
        real=[n for n in notes if not n.startswith('nothing')]
        return {},(real[0] if real else notes[0])

    def judge_one(inc,ms,a,b,wet,prior=None,wake=None):
        """v1.7 (GreMi round 1 on the 22 Nov stream, 23 Nov 2026) on top of v1.6. returns {car:(severity, why)}, note"""
        lap=ms[0]['lap']; lim=LIM1 if lap==1 else LIM2
        hm=[m for m in ms if m['t']-ms[0]['t']<HARM_S] if HARM_S else ms   # round 6: harm counts only near the touch itself
        g=lambda x,k,f=max,d=0: f([m[x].get(k) for m in hm if m[x].get(k) is not None] or [d])
        lost={x:g(x,'lost_s') for x in (a,b)}
        off={x:any(m[x].get('wheels_off_after',0)>=2 and m[x].get('wheels_off_before',0)<2 for m in hm) for x in (a,b)}
        m0=ms[0]; zone=m0.get('zone'); back=m0['back_id']; front=m0['front_id']
        rejoin={x:((ms[0][x].get('wheels_off_before',0)>=2 and (ms[0][x].get('off_time_before_s') or 0)>=0.5) or (ms[0][x].get('to_white_line_m') is not None and ms[0][x]['to_white_line_m']<-1.0 and (not REJOIN_SURF or (ms[0][x].get('off_time_before_s') or 0)>=0.2 or ms[0][x].get('wheels_off_before',0)>=2))) for x in (a,b)}   # round 10: the track edges can be metres out (Texas T1); trust the wheels
        if MAPREJ: rejoin={x:((ms[0][x].get('off_time_before_s') or 0)>=0.5 and (ms[0][x].get('to_white_line_m') is None or ms[0][x]['to_white_line_m']<0) and not (ms[0][y].get('off_time_before_s') or 0)>=0.5) for x,y in ((a,b),(b,a))}   # map track limits (24 Nov): all four tyres over the white line for 0.5 s+ just before, and the other car was not off too
        # v1.7: only the move BEFORE the first touch counts (what a car does after being hit is not its choice)
        # v1.7: lines differ in a battle (GreMi), so a move is the larger of the move vs the racing line and
        # the move across the track; the car ahead with no overlap (7.5 m+) owns its line: its moves don't count
        # round 3 (GreMi): the move vs the racing line, minus what the cars around did (a car going with the pack keeps its lane)
        def own_move(x):
            v=m0[x].get('toward_vs_line_before_m') or 0
            tk=m0[x].get('moved_toward_before_m')
            if MOVE_COMB and tk is not None:   # round 9: the move is seen on both the racing line and across the track
                v=max(v,tk) if MOVE_COMB==1 else (v+tk)/2 if MOVE_COMB==2 else min(v,tk)
            f=m0[x].get('flow_line_m')
            if FLOW and f is not None and f>0 and (m0[x].get('flow_n') or 0)>=FLOW_N: v=v-FLOW*f
            return round(v,1)
        before={x:own_move(x) for x in (a,b)}
        own_gap=max(OWN_GAP, OWN_T*(speed0[front] if (speed0:={x:(m0[x].get('speed') or 0) for x in (a,b)}) else 0)/3.6)   # round 9: at 340 km/h 7 m is a last-moment block (GreMi R9-3)
        if abs(m0['gap_m'])>=own_gap and (OWN_ALWAYS or before[back]>-1.0): before[front]=min(before[front],0)   # (unless the car behind had to move away)
        # v1.7: when the other car went 5 m+ the same way (pack drifting across), only the gap that closed counts
        for x,o in ((a,b),(b,a)):
            if before[o]<=-5 and before[x]>0: before[x]=max(0,before[x]+before[o])
        move=dict(before); swerve=dict(before)
        speed={x:(m0[x].get('speed') or 0) for x in (a,b)}
        overlap=abs(m0['gap_m'])<CAR_LEN
        def late(x):
            y=m0[x]
            if 'late_vs_field_pct' not in y: return 0,None
            lf=y['late_vs_field_pct']; lo=y.get('late_vs_own_pct') if lap!=1 else None
            if lf>=30: return lf,f"braked {lf}% later than the field"
            if lo is not None and lo>=20: return lo,f"braked {lo}% later than on his own laps"
            if (y.get('max') or 1)<0.6 and y.get('gap_when_braking') is not None and -30<y['gap_when_braking']<0: return 25,f"braked softly (max {round(100*y['max'])}%) closing on the car ahead"
            # round 4 (GreMi: Monza lap 1 #21): a bit late (10%+) and then braking far harder than on his own laps = left it too late
            if PANIC and (lf or 0)>=10 and y.get('own_decel40_kmh') and (y.get('decel40_kmh') or 0)>=1.5*y['own_decel40_kmh'] and (y.get('max') or 0)>=(y.get('own_max') or 1)+0.3:
                return 20,f"braked {lf}% later than the field and then {y['decel40_kmh']} km/h in 40 m (own laps {y['own_decel40_kmh']}): left it too late"
            # round 7 (GreMi R5-10 Austria: side by side into the corner = racing incident): not when the two are alongside at the same speed
            if NO_OFFBRAKE or (OFFBRAKE_ZONE and m0.get('phase') not in ('braking','apex')): return 0,None   # round 9: never on a straight / flat out
            if not (ALONG_OK and overlap and abs(y.get('closing_kmh') or 0)<2.5) and (y.get('off_line_at_brake_m') or 0)>3 and y.get('own_decel40_kmh') and y.get('decel40_kmh') is not None and y['decel40_kmh']<0.7*y['own_decel40_kmh']:
                return 20,f"came off the brake early ({y['off_line_at_brake_m']} m off the racing line, slowed {y['decel40_kmh']} km/h in 40 m, own laps {y['own_decel40_kmh']})"
            return 0,None
        hurt=any(lost[x]>=lim or off[x] for x in (a,b))
        # v1.7: deliberate - never braked, full throttle into a car that is braking (GreMi: Imola RobinGames21 = 10, kick)
        yb,yf=m0[back],m0[front]
        never=(yb.get('max') is None and 'braking' not in yb) or (yb.get('late_vs_field_pct') or 0)>=100
        if zone and m0['phase'] in ('braking','apex') and never and (yb.get('thr_now') or 0)>=0.9 \
                and (yf.get('brake_now') or 0)>=0.5 and speed[back]-speed[front]>=40:
            return {back:(10,f"never braked and hit a braking car on full throttle ({speed[back]} vs {speed[front]} km/h): on purpose")},''
        # v1.7: losing control (a slide or a spin) is the driver's own mistake: at fault, never above 3 (GreMi: Suzuka Overfast-_)
        def lost_control(x):
            y=m0[x]
            return (y.get('slide_deg') or 0)>=20 or (abs(y.get('steer_now') or 0)>=0.9 and (y.get('thr_now') or 0)<0.1 and (y.get('slide_deg') or 0)>=10)
        lc=[x for x in (a,b) if lost_control(x)]
        if len(lc)==1 and lc[0] in (wake or ()):
            return {},'lost control in the wake of an earlier crash'
        if len(lc)==1:
            x=lc[0]; o=b if x==a else a
            if not hurt: return {},'nothing (lost control, nobody lost time)'
            s=3 if (off[o] or lost[o]>=1.0) else 2
            return {x:(s,f"lost control (slide {m0[x].get('slide_deg')} deg) and hit the other car")},''
        # round 9 (GreMi Bahrain: 'hidde starts to move 0.6 s before, no time for NEX to react'): the car ahead moves into
        # the side the faster car behind is already pulling out to = a late block
        if m0.get('block')==front and speed[front]>=BLOCK_V and hurt or (m0.get('block')==front and speed[front]>=BLOCK_V and BLOCK_ANY):
            return {front:(3,"moved into the path of the faster car pulling out behind him (late block)")},''
        # 1. rejoining is always the rejoiner's responsibility (v1.7: the other car must really lose time or go off)
        rj=[x for x in (a,b) if rejoin[x]]
        if len(rj)==1:
            x=rj[0]; o=b if x==a else a
            if not (lost[o]>=lim or off[o]): return {},'nothing (rejoin, the other car lost no time)'
            s=4 if lost[o]<3 else 5 if lost[o]<10 else 6
            return {x:(s,f"rejoined the track into the other car (it lost {lost[o]:.1f} s)")},''
        lt={x:late(x) for x in (a,b)}
        swerving=[x for x in (a,b) if swerve[x]>=5 and speed[x]>250 and overlap]
        # round 4 (GreMi Q18 'the same dive with a different outcome gets the same severity'; Silverstone QDR_SHW1KS):
        # a dive from behind in a braking zone, 4 m+ across towards the car ahead and closing 20 km/h+, counts even when nobody lost time
        dive=DIVE and zone and m0['phase'] in ('braking','apex') and before[back]>=DIVE and before[front]<0.5 and (m0[back].get('closing_kmh') or 0)>=20 and abs(m0['gap_m'])<10
        lastmin=[x for x,o in ((a,b),(b,a)) if LASTMIN and overlap and speed[x]>250 and before[x]>=LASTMIN and before[o]<=-1.5
                 and (m0[o].get('moved_toward_before_m') is None or m0[o]['moved_toward_before_m']<=-1.5)]
        reckless=any(lt[x][0]>=50 for x in (a,b)) or bool(swerving) or dive or bool(lastmin)
        # round 6 (GreMi: Shanghai Overfast/Senna 'such a small tap', Austria 1:46 'racing incident'): a contact that cost
        # at most MINOR s, put nobody off and closed under 20 km/h is nothing unless the move itself was reckless
        if MINOR and not reckless and not any(off.values()) and max(lost.values())<=MINOR and abs(m0[back].get('closing_kmh') or 0)<20:
            return {},'nothing: a small touch that cost nobody anything'
        # round 10 (GreMi Baku thomas/tm, Bahrain Alexowitsh77): a clear move into a car is an incident (low severity) even when it cost nothing
        if NOHARM_MV and not hurt and not reckless:
            nh=[x for x,o in ((a,b),(b,a)) if before[x]>=NOHARM_MV and before[o]<NOHARM_O]
            if len(nh)==1: return {nh[0]:(1,f"moved {before[nh[0]]} m into the other car (it cost nothing)")},''
        if not hurt and not reckless:
            return {},f"nothing: nobody lost {lim:.1f} s or was pushed off"
        # round 3 (GreMi: Silverstone 'such a slight touch'): a nose-to-tail touch under 10 km/h, nobody off, nobody 1 s+ down = nothing
        if not overlap and abs(m0[back].get('closing_kmh') or 0)<LIGHT_KMH and not any(off.values()) and max(lost.values())<1.0 and not reckless:
            return {},'nothing: a light touch'
        if not hurt and swerving and not any(lt[x][0]>=50 for x in (a,b)):
            # v1.7: side by side at top speed, a big move but nobody hurt: both share it (GreMi: Baku vanderdeured/Lenny)
            return {a:(2,"side by side at top speed, neither left room"),b:(2,"side by side at top speed, neither left room")},''
        out={}
        yb,yf=m0[back],m0[front]
        # round 4 (GreMi Q21 'braking much harder than normal and getting hit is on them'; Monza #21, Shanghai braaf):
        # the car ahead slowed far harder than on its own laps (brake check or lost traction) and the car behind did not brake late
        crash_ahead0=any(m0['t']-2.0<=tt<m0['t'] for tt in (prior or {}).get(front,[]))
        if BRAKECHK and not wet and not dive and not crash_ahead0 and zone and (not BC_STRICT or m0['phase'] not in ('braking','apex') or (yf.get('late_vs_field_pct') or 0)<=-15) and not (lap==1 and m0['t']<30) and yf.get('own_decel40_kmh') and yf['own_decel40_kmh']>=20 and (yf.get('decel40_kmh') or 0)>=BRAKECHK*yf['own_decel40_kmh'] and (yf.get('decel40_kmh') or 0)-yf['own_decel40_kmh']>=25 \
                and lt[back][0]<30 and not (yb.get('own_decel40_kmh') and (yb.get('decel40_kmh') or 0)/yb['own_decel40_kmh']>=(yf.get('decel40_kmh') or 0)/yf['own_decel40_kmh']):
            s=3 if (lost[back]>=3 or off[back]) else 2
            # round 7 (GreMi R6-7 Austria: 'Car 3 should not defend there, and devildriver should have backed off a little'):
            # the car behind kept closing fast and moved towards him as well -> shared
            if BC_SHARE and abs(yb.get('closing_kmh') or 0)>=BC_SHARE and (yb.get('toward_vs_line_before_m') or 0)>=1.0 and (yb.get('moved_toward_before_m') or 0)>=1.0:
                return {front:(s,f"slowed far harder than on his own laps ({yf['decel40_kmh']} km/h in 40 m, own laps {yf['own_decel40_kmh']}) in front of a faster car"),
                        back:(2,f"kept closing ({abs(yb.get('closing_kmh') or 0):.0f} km/h) and moved {yb['moved_toward_before_m']} m towards him instead of backing off")},''
            return {front:(s,f"slowed far harder than on his own laps ({yf['decel40_kmh']} km/h in 40 m, own laps {yf['own_decel40_kmh']}) with a car close behind")},''
        # round 10 (GreMi R7-1 Brazil vanderdeured, Monza sprintstar-1): braking far earlier than on his own laps with a car
        # closing behind is slowing unexpectedly (reason 10), as long as the car behind did not brake late itself
        if EARLYBRK and not wet and zone and not crash_ahead0 and not (lap==1 and m0['t']<30) and m0['phase'] in ('braking','apex') \
                and yf.get('late_vs_own_pct') is not None and yf['late_vs_own_pct']<=-EARLYBRK and (yb.get('closing_kmh') or 0)>=EARLY_CL and lt[back][0]<20:
            return {front:(2,f"braked far earlier than on his own laps ({-yf['late_vs_own_pct']}% earlier) with a car closing behind")},''
        # round 4 (GreMi: Suzuka Red Bull #21 'not to blame for another driver driving so slowly close to the racing line'):
        # on a flat-out part a car going 40%+ slower than the car behind is a hazard, not a target
        if SLOWCAR and not zone and not overlap and speed[front]<SLOWCAR*speed[back]:
            tb=m0[back].get('moved_toward_before_m'); tf=m0[front].get('moved_toward_before_m')
            if before[front]>=1.5 and before[back]<=-1.0 and tb is not None and tb<=-1.5:
                # (GreMi: Suzuka RobinGames21 crawling back across the track into a car that was steering away)
                return {front:(3,f"was very slow ({speed[front]} km/h) and moved {before[front]:.1f} m across into a car that was steering away")},''
            return {},f"racing incident: the car ahead was very slow on a flat-out part ({speed[front]} vs {speed[back]} km/h)"
        # 2. late / soft / off-line braking by the car behind
        if zone and m0['phase'] in ('braking','apex') and lt[back][0]>=20:
            v,why=lt[back]; s=8 if v>=50 else 5 if v>=30 else 3 if v>=25 else 2
            out[back]=(s,why)
        # 3. moving into a car that held its line (before the touch only)
        trk={x:m0[x].get('moved_toward_before_m') for x in (a,b)}
        def unclear(x,o):
            # round 3 (GreMi: Austria vanderdeured 'both their lines are not'): the track says the other car moved clearly more
            if abs(m0['gap_m'])>=OWN_GAP and o==front: return False   # the car ahead with no overlap owns its line
            return AMBIG and trk[x] is not None and trk[o] is not None and trk[o]-trk[x]>=AMBIG
        for x,o in ((a,b),(b,a)):
            # round 4 (GreMi: 'if one driver tries to avoid it and it still happens, it is on the other'):
            # the other car steered away on both measures while this car closed in across the track
            dodge = DODGE and ((trk[x] is not None and trk[o] is not None and before[o]<=-1.5 and trk[o]<=-1.5 and trk[x]>=1.5)
                               or (trk[o] is None and before[o]<=-2.0 and before[x]>=2.0)) \
                and not (x==front and abs(m0['gap_m'])>=OWN_GAP)
            if dodge:
                move[x]=max(move[x],trk[x] if trk[x] is not None else move[x])
            elif unclear(x,o): continue
            if (move[x]>=MOVE_MIN and move[o]<O_LIM) or (move[x]>=M2 and move[x]>=move[o]+DIFF) or (before[x]>=BOTHM and before[o]>=BOTHM and abs(before[x]-before[o])<1.0):
                s=2 if move[x]<1.5 else 3 if move[x]<4.5 else 5
                if s<5 and (off[o] or lost[o]>=3): s+=1
                if s>=5 and speed[x]>250: s=6
                if swerve[x]>=5 and speed[x]>250 and overlap: s=8 if (off[o] or lost[o]>=3) else 6   # round 3: the big number only when it really cost the other car
                if x==back and zone and m0['gap_m']>CAR_LEN and move[x]>=3 and s<5: s=5   # dive without overlap that hits
                why=f"moved {move[x]:.1f} m towards the other car before the touch" + (" and pushed it off the track" if off[o] else "")
                if x in out: s=max(s,out[x][0]); why=out[x][1]+"; "+why
                out[x]=(s,why)
        # 4. nobody moved, nobody braked late: hitting the car ahead without overlap
        if not out:
            gap=m0['gap_m']
            y=m0[back]
            normal=y.get('own_decel40_kmh') is None or (y.get('decel40_kmh') or 0)>=0.9*y['own_decel40_kmh']
            crash_ahead=any(m0['t']-2.0<=tt<m0['t'] for tt in (prior or {}).get(front,[]))
            if gap>CAR_LEN and not crash_ahead and not (lap==1 and normal and lost[front]<lim*2):
                ck=y.get('closing_kmh') or 0
                s=2 if ck<20 else 3 if ck<50 else 4 if ck<90 else 5   # v1.7: harder hits weigh more
                out[back]=(s,f"ran into the car ahead (closing {ck} km/h)")
        for x,(s,why) in list(out.items()):
            y=m0[x]
            if not hurt: s=min(s,3)   # round 4: a move that cost nobody anything stays small
            braking_call=not why.startswith('moved')
            if y.get('own_decel40_kmh') and (y.get('decel40_kmh') or 0)>=1.3*y['own_decel40_kmh'] and s>2 and not braking_call: s-=1; why+="; braked hard to avoid it"
            # v1.7: rain only softens braking calls, not moves
            if wet and s>1 and braking_call: s-=1
            # v1.7: a slow hit from behind stays small (GreMi: Austria toni2608 = 3)
            if x==back and not overlap and (y.get('closing_kmh') or 0)<20: s=min(s,3)
            out[x]=(max(1,s),why)
        # round 8 (GreMi R7-6 Spa: 'toni is nice on his line and cant do much more'): flat out, the only car that lost anything is the one that moved = racing incident
        if SELF_HARM and out and lap>1 and m0['phase'].startswith('no braking') and min(speed[a],speed[b])>=250 and all(w.startswith('moved') for _,w in out.values()) and not reckless and all(lost[o]<0.2 and not off[o] for x in out for o in (a,b) if o!=x) and not any(off[x] for x in out):
            return {},'racing incident'
        # round 8 (GreMi R7-20 Madrid: 'a lap 1 racing incident'): the slow first-corner pack on lap 1, small calls = racing incident
        if LAP1_PACK and out and lap==1 and m0['t']<(LAP1_PACK2 if max(abs(before[a]),abs(before[b]))<LAP1_MV else LAP1_PACK) and m0['phase'] in ('braking','apex') and max(speed[a],speed[b])<100 and max(v[0] for v in out.values())<=3:
            return {},'racing incident (lap 1 first-corner pack)'
        return out,'racing incident' if not out else ''


    FLOW, FLOW_N = 0.0, 2
    SPLIT, DODGE = 3.0, True
    BRAKECHK, SLOWCAR = 1.3, 0.6
    BC_SHARE = 20
    ALONG_OK = True
    SELF_HARM, LAP1_PACK, SECOND_HARM = True, 15, 0
    SECOND_MODE, OFFBRAKE_ZONE = 3, True
    REJOIN_SURF = False
    MAPREJ = False
    EDGEMV = os.environ.get('EDGEMV','0')=='1'
    MAPLINE = os.environ.get('MAPLINE','0')=='1'; MAP = getattr(j.race, 'map', None)
    NOHARM_MV, NOHARM_O = 0.0, 0.5
    EARLYBRK, EARLY_CL = 0, 10
    OWN_T, LAP1_PACK2, LAP1_MV, NO_OFFBRAKE = 0.0, 20, 3.0, False
    BLOCK_V, BLOCK_ANY = 150, True
    LAT_NEAREST = True
    O_LIM, M2, DIFF, BOTHM = 0.5, 1.5, 1.0, 1.5
    MOVE_COMB = 0
    OWN_ALWAYS = False
    LAP1_FIELD = False
    LIM1 = 1.0
    DIVE, PANIC = 4.0, True
    LIM2, HARM_S, OWN_GAP, LASTMIN, BC_STRICT, THROTTLE_HIT = 0.5, 3, 6.5, 3, True, True
    MINOR = 0
    LIGHT_KMH, MOVE_MIN, AMBIG = 5, 1.5, 2.0
    CHAIN_S = 3.0   # contacts this soon after the first one are its aftermath (GreMi: one mistake starting chaos = the initiator)
    measured = []
    for inc in incs:
        ms = {}
        for c in inc["contacts"]:
            try:
                m = measure(inc, c)
            except Exception:
                m = None
            if m:
                ms.setdefault(frozenset((c["a"], c["b"])), []).append((c, m))
        measured.append(ms)
    allc = [(m["t"], c["a"], c["b"], m["lap"], m["d"], n) for n, ms in enumerate(measured) for lst in ms.values() for c, m in lst]
    res = []
    for n, (inc, ms) in enumerate(zip(incs, measured)):
        wet = (j.weather_at(inc["t0"]) or 0) >= 3
        fault, notes, contacts = {}, [], []
        order = sorted(ms.items(), key=lambda kv: kv[1][0][1]["t"])
        t_first = order[0][1][0][1]["t"] if order else None
        involved = set()
        for pair, lst in order:
            a, b = sorted(pair)
            c0, m0 = lst[0]
            t = m0["t"]
            prior = {}
            for c in inc["contacts"]:
                if frozenset((c["a"], c["b"])) != pair:
                    for q in (c["a"], c["b"]):
                        prior.setdefault(q, []).append(c["t"])
            # round 3 (GreMi: Imola K7HYRAX lost it because RobinGames21 hit him first): an earlier crash nearby
            wake = {a, b} if any(k != n and t - 3 <= ct < t and lp == m0["lap"] and abs(dd - m0["d"]) < 150 for ct, _, _, lp, dd, k in allc) else set()
            try:
                o, note = judge_pair(inc, [m for c, m in lst], a, b, wet, prior, wake)
            except Exception as ex:
                o, note = {}, "not judged: %s" % ex
            if involved and t - t_first <= CHAIN_S:
                keep = {}
                for x, (s_, why) in o.items():
                    oth = b if x == a else a
                    if s_ >= 10:
                        keep[x] = (s_, why); continue
                    hit_before = any(t - 0.4 <= ct < t and oth in (ca, cb) and {ca, cb} != {a, b} for ct, ca, cb, _, _, _ in allc)
                    y, yo = m0[x], m0[oth]; lim = 1.0 if m0["lap"] == 1 else 0.5
                    hurt_o = (yo.get("lost_s") or 0) >= lim or (yo.get("wheels_off_after", 0) >= 2 and yo.get("wheels_off_before", 0) < 2)
                    # a NEW car joining the chain that clearly moves (3 m+) into a car and hurts it (GreMi: Baku T1 vanderdeured, a little)
                    if x not in involved and (y.get("toward_vs_line_before_m") or 0) >= 3 and hurt_o and not hit_before:
                        keep[x] = (2, why + " (joined the chain)")
                was = bool(o) or not note.startswith("nothing")
                o = keep
                if not o:
                    note = "aftermath of the first contact" + (", it cost time" if was else "")
            involved |= set(pair)
            inc.setdefault('_ms', []).append({'a':a,'b':b,'ms':[m for c,m in lst],'out':{str(k):v for k,v in o.items()},'note':note})
            for x, (s_, why) in o.items():
                if x not in fault or s_ > fault[x][0]:
                    fault[x] = (s_, why)
            if o:
                for x, (s_, why) in o.items():
                    contacts.append({"a": a, "b": b, "t": c0["t"], "rule": "V17", "severity": s_, "verdict": name(x) + " at fault",
                                     "why": name(x) + " " + why, "at_fault": x, "at_fault_all": [x]})
            else:
                r1 = note.startswith("nothing")
                contacts.append({"a": a, "b": b, "t": c0["t"], "rule": "R1" if r1 else "V17", "severity": 1,
                                 "verdict": "Not an incident" if r1 else "Racing incident", "why": note, "at_fault": None, "at_fault_all": []})
            notes.append(note)
        sev = max([s_ for s_, _ in fault.values()] or [1])
        own_notes = [x for x in notes if not x.startswith("aftermath")]
        rule = "V17" if fault else ("R1" if own_notes and all(x.startswith("nothing") for x in own_notes) and not any(x.endswith("cost time") for x in notes) else "V17")
        verdict = (" + ".join(name(x) for x in fault) + " at fault") if fault else ("Not an incident" if rule == "R1" else "Racing incident")
        why = "; ".join(name(x) + " " + w for x, (s_, w) in fault.items()) or (notes[0] if notes else "no contact between drivers")
        cars = sorted(fault)
        if not contacts:
            c = inc["contacts"][0]
            contacts = [{"a": c["a"], "b": c["b"], "t": c["t"], "rule": "R6", "severity": 1, "verdict": "AI", "why": "AI car",
                         "at_fault": None, "at_fault_all": []}]
        res.append({"rule": rule, "severity": sev, "verdict": verdict, "why": why, "at_fault": cars[0] if cars else None,
                    "at_fault_all": cars, "contacts": contacts})
    return res
