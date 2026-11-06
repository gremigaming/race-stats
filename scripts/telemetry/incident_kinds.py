#!/usr/bin/env python3
"""Incident types and how a contact was made, for the staff page (GreMi, 5 Nov 2026).

kind_of(incident) guesses the type of an incident from the fault engine's verdict file
(fault_engine.py, after precedents.py): the staff page's picker starts on it and staff can change
it or add a type. phase_of(contact, car) says how the car at fault made the contact (braking,
turning in / moving across, on the straight) for the driver summaries. No numpy here:
safety_rating.py imports it.
"""

WEATHER = ["Clear", "Light cloud", "Overcast", "Light rain", "Heavy rain", "Storm"]


def weather_name(code):
    if code is None:
        return None
    return WEATHER[code] if 0 <= code < len(WEATHER) else str(code)


KINDS = ["Rear-end", "Moved across alongside", "Late lunge / divebomb", "Unsafe rejoin", "Blocking / brake-check",
         "Retaliation", "Lost control", "Chain reaction", "Racing incident", "Not an incident"]
LUNGE_KMH = 30       # running into a car this fast from behind = a late lunge, not a plain rear-end


def kind_of(inc):
    """Best guess of the incident type for the staff page's picker (GreMi, 5 Nov 2026: autofilled,
    staff can change it). Works on a verdict file's incident (fault_engine.py); a call that came
    from a grade or a precedent is typed from the rulebook's own call."""
    rb = inc.get("rulebook") or {}
    rule = rb.get("rule") if inc.get("rule") in ("G", "P") and rb.get("rule") else inc.get("rule")
    why = (rb.get("why") if rule == rb.get("rule") and rb else None) or inc.get("why") or ""
    counted = [c for c in inc.get("contacts") or [] if c.get("rule") != "R6"]
    main = next((c for c in counted if c.get("at_fault")), counted[0] if counted else None)
    f = (main or {}).get("f") or {}
    closing = abs(f.get("closing_kmh") or 0)
    if inc.get("rule") == "R1" or rule == "R1":
        return "Not an incident"
    if rule == "R5":
        return "Unsafe rejoin"
    if rule == "R9":
        return "Retaliation"
    if rule == "R10":
        return "Rear-end"   # kept full throttle into a braking car (GreMi graded daris into DDRK as a rear-end)
    if rule == "R4":
        return "Chain reaction"
    if rule == "R7":
        return "Chain reaction" if "aftermath" in why else "Lost control" if "lost the car" in why else "Racing incident"
    if rule == "R2" and "swept" in why:
        return "Blocking / brake-check"
    if rule in ("R2", "R8"):
        return "Late lunge / divebomb" if closing >= LUNGE_KMH else "Moved across alongside"
    if rule == "R3":
        if "hardly closing" in why:
            return "Racing incident"
        return "Late lunge / divebomb" if closing >= LUNGE_KMH else "Rear-end"
    return "Racing incident"


def phase_of(c, car):
    """How a car at fault made the contact: "braking", "turning in / moving across" or "on the straight"."""
    f = c.get("f") or {}
    brake = (f.get("brake") or {}).get(str(car)) or 0
    steer = abs((f.get("steer") or {}).get(str(car)) or 0)
    moved = (f.get("moved") or {}).get(str(car)) or 0
    if brake >= 0.3:
        return "braking"
    if steer >= 0.12 or moved >= 1.0:
        return "turning in / moving across"
    return "on the straight"
