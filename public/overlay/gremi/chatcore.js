// Shared chat feed for GreMi's on-screen chat (chat.html) and the OBS dock (dock.html).
// Twitch + YouTube from Streamer.bot (ws://127.0.0.1:8080), TikTok from TikFinity (ws://localhost:21213).
// Everything is normalised to one message shape:
//   { id, platform: twitch|youtube|tiktok, name, color, text, html, badges: [{src|svg, title}],
//     roles: Set(broadcaster, lead, mod, vip, sub, first, gifter, follower), event: false }
// and one event shape for the activity feed:
//   { id, platform, kind: follow|sub|resub|gift|giftbomb|raid|cheer|superchat|member|like|share, name, amount, text, big: bool }
// NOTE: never send GetMonitoredYouTubeBroadcasts: Streamer.bot 1.0.x drops the whole connection on it.
(function () {
  const q = new URLSearchParams(location.search);
  const LEAD = new Set((q.get("lead") || "ddrk0,littleegend").toLowerCase().split(","));
  const HOST = /^gremi[_ ]?gaming$/i;
  // bots: every platform, any bot. Names plus a "...bot" ending.
  const BOTS = new Set(("streamelements,streamlabs,nightbot,moobot,fossabot,wizebot,sery_bot,botrix,botrixoficial,kofistreambot," +
    "soundalerts,streamstickers,commanderroot,frostytoolsdotcom,pokemoncommunitygame,tangiabot,blerp,own3d,lumiastream,mixitupbot," +
    "gremi_chat,gremi_clips,racecontroll,racecontrol,gremi_bot,casterlabs,restreambot,restream,tikfinity,streamerbot," + (q.get("ignore") || ""))
    .toLowerCase().split(",").filter(Boolean));
  const isBot = (name, extra) => {
    const n = String(name || "").toLowerCase().trim();
    return !!extra || BOTS.has(n) || /(^|[_\-.])bot$|bot\d*$/.test(n);
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const ICON = {
    twitch: '<svg class="pf" viewBox="0 0 24 24"><path fill="#a970ff" d="M4 2 2.5 6v14h5v3h3l3-3h4l5-5V2H4Zm16 12-3 3h-4.5l-3 3v-3H5.5V4H20v10Zm-3.5-6.5h-2v6h2v-6Zm-5 0h-2v6h2v-6Z"/></svg>',
    youtube: '<svg class="pf" viewBox="0 0 24 24"><path fill="#ff3b30" d="M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2C.5 9.1.5 12 .5 12s0 2.9.5 4.8a3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-4.8.5-4.8s0-2.9-.5-4.8Z"/><path fill="#fff" d="m9.7 15.5 6-3.5-6-3.5v7Z"/></svg>',
    tiktok: '<svg class="pf" viewBox="0 0 24 24"><path fill="#25f4ee" d="M16.6 2h-3.4v13.3a2.9 2.9 0 1 1-2.1-2.8V9a6.4 6.4 0 1 0 5.5 6.3V8.6a8 8 0 0 0 4.7 1.5V6.7A4.8 4.8 0 0 1 16.6 2Z"/><path fill="#fe2c55" d="M17.4 2.8h-.8V15.3a5.6 5.6 0 0 1-9.2 4.3 6.4 6.4 0 0 0 10-5.1V8.6a8 8 0 0 0 4.7 1.5v-.8a4.8 4.8 0 0 1-4.7-6.5Z" opacity=".7"/></svg>',
  };
  // small badge icons for platforms that don't send images (YouTube, TikTok)
  const B = (bg, path, title) => ({ title, svg: `<svg class="bd" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="${bg}"/><path fill="#fff" d="${path}"/></svg>` });
  const BADGE = {
    owner: B("#ff3b30", "M12 4l2.4 5 5.6.6-4.2 3.7 1.2 5.5L12 16l-5 2.8 1.2-5.5L4 9.6 9.6 9z", "Owner"),
    mod: B("#00ad03", "M7 17l-2 2 1 1 2-2 2 2 1-1-2-2 6.5-6.5 1.5 1.5 3-3V4h-5l-3 3 1.5 1.5z", "Moderator"),
    member: B("#2ba640", "M12 3l2.6 5.6 6 .6-4.5 4 1.3 6L12 16.2 6.6 19.2l1.3-6-4.5-4 6-.6z", "Member"),
    verified: B("#606060", "M9.5 16.2 5.8 12.5l1.4-1.4 2.3 2.3 7.3-7.3 1.4 1.4z", "Verified"),
    sub: B("#8b5cf6", "M12 3l2.6 5.6 6 .6-4.5 4 1.3 6L12 16.2 6.6 19.2l1.3-6-4.5-4 6-.6z", "Subscriber"),
    gifter: B("#f5b301", "M4 18h16l-1.5-9-4.5 4L12 6l-2 7-4.5-4z", "Top gifter"),
    friend: B("#fe2c55", "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 19c0-3 3-5 6-5s6 2 6 5zm12 0c0-1.4-.5-2.7-1.4-3.7.9-.4 2-.3 3.4-.3 3 0 6 2 6 4z", "Friend"),
  };

  function render(text, emotes = []) {
    if (!emotes || !emotes.length) return esc(text);
    const byIndex = emotes.filter((e) => e.startIndex != null && e.imageUrl).sort((a, b) => a.startIndex - b.startIndex);
    if (byIndex.length) {
      const chars = Array.from(text); let out = "", i = 0;
      for (const e of byIndex) { out += esc(chars.slice(i, e.startIndex).join("")) + `<img class="emote" src="${esc(e.imageUrl)}" alt="">`; i = e.endIndex + 1; }
      return out + esc(chars.slice(i).join(""));
    }
    const map = Object.fromEntries(emotes.filter((e) => e.imageUrl).map((e) => [e.name, e.imageUrl]));
    return text.split(/(\s+)/).map((w) => (map[w] ? `<img class="emote" src="${esc(map[w])}" alt="">` : esc(w))).join("");
  }

  let seq = 0;
  const lower = (s) => String(s || "").toLowerCase();

  function twitchMsg(d) {
    const m = d.message || {}, u = d.user || {};
    const text = typeof m === "string" ? m : m.message ?? m.text ?? "";
    const login = lower(u.login || m.username || u.name);
    const name = u.name || m.displayName || m.username || "";
    const roles = new Set();
    const role = +(m.role ?? u.role ?? 0);              // 1 viewer, 2 vip, 3 mod, 4 broadcaster
    if (role === 4 || HOST.test(login)) roles.add("broadcaster");
    if (role === 3) roles.add("mod");
    if (role === 2) roles.add("vip");
    if (m.subscriber || u.subscribed) roles.add("sub");
    if (m.firstMessage || d.isFirstMessage) roles.add("first");
    if (LEAD.has(login) || LEAD.has(lower(name))) roles.add("lead");
    const badges = (m.badges || u.badges || []).map((b) => ({ src: b.imageUrl || b.image_url, title: b.name || "" })).filter((b) => b.src);
    return { id: "tw" + (m.msgId || ++seq), platform: "twitch", name, login, color: u.color || m.color, text,
             html: render(text, m.emotes || []), badges, roles, bot: isBot(login) || isBot(name) };
  }
  function youtubeMsg(d) {
    const u = d.user || {}, text = typeof d.message === "string" ? d.message : d.message?.message ?? d.text ?? "";
    const roles = new Set(), badges = [];
    if (u.isOwner) { roles.add("broadcaster"); badges.push(BADGE.owner); }
    if (u.isModerator) { roles.add("mod"); badges.push(BADGE.mod); }
    if (u.isSponsor) { roles.add("sub"); badges.push(BADGE.member); }
    if (u.isVerified) badges.push(BADGE.verified);
    if (LEAD.has(lower(u.name))) roles.add("lead");
    return { id: "yt" + (d.eventId || d.id || ++seq), platform: "youtube", name: u.name || "", login: lower(u.name), color: null, text,
             html: render(text, d.emotes || []), badges, roles, bot: isBot(u.name) };
  }
  function tiktokMsg(d) {
    const name = d.nickname || d.uniqueId || "", login = lower(d.uniqueId);
    const roles = new Set(), badges = [];
    if (d.isModerator) { roles.add("mod"); badges.push(BADGE.mod); }
    if (d.isSubscriber) { roles.add("sub"); badges.push(BADGE.sub); }
    if (d.topGifterRank) { roles.add("gifter"); badges.push(Object.assign({}, BADGE.gifter, { title: "Top gifter #" + d.topGifterRank })); }
    if (+d.followRole === 2) badges.push(BADGE.friend);
    for (const b of d.userBadges || []) { const src = b.url || b.image?.url || b.imageUrl; if (src) badges.push({ src, title: b.name || b.type || "" }); }
    if (LEAD.has(login) || LEAD.has(lower(name))) roles.add("lead");
    if (HOST.test(login)) roles.add("broadcaster");
    return { id: "tt" + (d.msgId || ++seq), platform: "tiktok", name, login, color: null, text: d.comment || "", html: esc(d.comment || ""),
             badges, roles, bot: isBot(login) || isBot(name) };
  }

  // ---- events (activity feed)
  // The person behind an event. Streamer.bot 1.0 moved names around (user / targetUser / user_name / displayName),
  // so look in every known place, then in any nested object except the broadcaster.
  function pickName(d) {
    const nm = (o) => o && typeof o === "object" ? (o.name || o.displayName || o.display_name || o.userName || o.login || o.user_name || o.user_login) : null;
    const direct = nm(d.user) || nm(d.targetUser) || d.user_name || d.userName || d.displayName || d.display_name || d.user_login || d.username || nm(d.message);
    if (direct) return direct;
    for (const [k, v] of Object.entries(d)) if (k !== "broadcaster" && v && typeof v === "object" && nm(v)) return nm(v);
    return "";
  }
  function sbEvent(ev, d, on) {
    const who = pickName(d);
    if (!who && ev.type !== "ChatMessage" && ev.type !== "Message") console.warn("[chatcore] no name in", ev.type, JSON.stringify(d).slice(0, 800));
    const e = (kind, extra) => on.event && on.event(Object.assign({ id: "ev" + (++seq), at: Date.now(), platform: ev.source === "YouTube" ? "youtube" : "twitch", kind, name: who }, extra));
    switch (`${ev.source}.${ev.type}`) {
      case "Twitch.ChatMessage": { const m = twitchMsg(d); if (!m.bot) on.chat && on.chat(m); return; }
      case "YouTube.Message": { const m = youtubeMsg(d); if (!m.bot) on.chat && on.chat(m); return; }
      case "Twitch.Follow": return e("follow");
      case "Twitch.Sub": return e("sub", { text: d.sub_tier ? "Tier " + String(d.sub_tier).replace(/000$/, "") : "" });
      case "Twitch.ReSub": return e("resub", { amount: d.cumulativeMonths ?? d.cumulative_months, text: d.text || d.message?.text || "" });
      case "Twitch.GiftSub": return e("gift", { text: "to " + (d.recipient?.name || d.recipientDisplayName || "") });
      case "Twitch.GiftBomb": return e("giftbomb", { amount: d.gifts ?? d.total, big: true });
      case "Twitch.Raid": return e("raid", { name: d.from_broadcaster_user_name || who, amount: d.viewers, big: true });
      case "Twitch.Cheer": return e("cheer", { amount: d.bits ?? d.message?.bits, text: d.message?.message || "", big: (d.bits ?? 0) >= 500 });
      case "YouTube.SuperChat": return e("superchat", { amount: d.amount, text: d.message || "", big: true });
      case "YouTube.SuperSticker": return e("superchat", { amount: d.amount, text: "Super Sticker", big: true });
      case "YouTube.NewSponsor": return e("member");
      case "YouTube.MembershipGift": return e("giftbomb", { amount: d.count ?? d.gifts, big: true });
      case "YouTube.NewSubscriber": return e("follow");
    }
  }

  function connectSB(on, opts = {}) {
    const ws = new WebSocket(`ws://${q.get("sb") || "127.0.0.1:8080"}/`);
    ws.onopen = () => {
      on.status && on.status("sb", true);
      ws.send(JSON.stringify({ request: "Subscribe", id: "gremi-chat", events: {
        Twitch: ["ChatMessage", "Follow", "Sub", "ReSub", "GiftSub", "GiftBomb", "Raid", "Cheer"],
        YouTube: ["Message", "SuperChat", "SuperSticker", "NewSponsor", "MembershipGift", "NewSubscriber"] } }));
    };
    ws.onmessage = (m) => { try { const j = JSON.parse(m.data); if (j.event) sbEvent(j.event, j.data || {}, on); } catch (e) { console.warn(e); } };
    ws.onclose = () => { on.status && on.status("sb", false); setTimeout(() => connectSB(on, opts), 5000); };
    return ws;
  }
  function connectTF(on) {
    const ws = new WebSocket(`ws://localhost:${q.get("tikfinity") || 21213}/`);
    ws.onopen = () => on.status && on.status("tt", true);
    ws.onmessage = (m) => {
      try {
        const j = JSON.parse(m.data), d = j.data || {}, name = d.nickname || d.uniqueId;
        const e = (kind, extra) => on.event && on.event(Object.assign({ id: "tt" + (++seq), at: Date.now(), platform: "tiktok", kind, name }, extra));
        if (isBot(d.uniqueId) || isBot(d.nickname)) return;
        if (j.event === "chat") { const msg = tiktokMsg(d); if (!msg.bot) on.chat && on.chat(msg); }
        if (j.event === "follow") e("follow");
        if (j.event === "share") e("share");
        if (j.event === "subscribe") e("sub");
        if (j.event === "gift" && (d.giftType !== 1 || d.repeatEnd)) {
          const n = d.repeatCount || 1, coins = (d.diamondCount || 0) * n;
          e("gift", { amount: n, text: d.giftName || "gift", coins, img: d.giftPictureUrl, big: coins >= 100 });
        }
      } catch (e) { console.warn(e); }
    };
    ws.onclose = () => { on.status && on.status("tt", false); setTimeout(() => connectTF(on), 5000); };
    return ws;
  }

  // header HTML: platform logo + badges + name, always on one line
  function who(m, opts = {}) {
    const color = m.color || ({ twitch: "#bf94ff", youtube: "#ff6b6b", tiktok: "#25f4ee" })[m.platform];
    const badges = m.badges.map((b) => b.svg || `<img class="bd" src="${esc(b.src)}" alt="" title="${esc(b.title)}">`).join("");
    const crown = m.roles.has("broadcaster") || m.roles.has("lead") ? '<span class="crown">♛</span>' : "";
    return `<span class="who">${opts.noLogo ? "" : ICON[m.platform] || ""}${badges}${crown}<span class="n" style="--c:${esc(color)}">${esc(m.name)}</span></span>`;
  }
  // special viewer class: the strongest role wins
  function tier(m) {
    const r = m.roles;
    return r.has("broadcaster") || r.has("lead") ? "t-gold" : r.has("mod") ? "t-mod" : r.has("vip") ? "t-vip" :
           r.has("gifter") ? "t-gifter" : r.has("sub") ? "t-sub" : "";
  }

  window.GremiChat = { pickName, connectSB, connectTF, who, tier, esc, ICON, BADGE, isBot, render, LEAD };
})();
