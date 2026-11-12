#!/usr/bin/env python3
"""
Process an X12 278 (005010X217) Health Care Services Review request file.

Usage:
    python process_278.py sample_278_request.edi            # readable summary
    python process_278.py sample_278_request.edi --json     # JSON output
"""
import json
import sys

HL_LEVELS = {
    "20": "payer",        # Utilization Management Organization (UMO)
    "21": "requester",    # Requester
    "22": "subscriber",   # Subscriber
    "23": "dependent",    # Dependent
    "EV": "event",        # Patient event
    "SS": "service",      # Service
}


# --------------------------------------------------------------------------
# Parsing
# --------------------------------------------------------------------------
def parse_segments(raw: str):
    """Split raw EDI text into a list of segments (each a list of elements).

    Delimiters are read from the fixed-width ISA segment:
      - element separator  = character at index 3
      - component separator = ISA16 (index 104)
      - segment terminator = character at index 105
    """
    raw = raw.lstrip("\ufeff").lstrip()
    if not raw.startswith("ISA") or len(raw) < 106:
        raise ValueError("File does not start with a valid ISA segment")

    elem_sep = raw[3]
    comp_sep = raw[104]
    seg_term = raw[105]

    segments = []
    for chunk in raw.split(seg_term):
        chunk = chunk.strip()
        if chunk:
            segments.append(chunk.split(elem_sep))
    return segments, elem_sep, comp_sep, seg_term


def get(seg, idx, default=""):
    """Safe element access (idx is the X12 position, e.g. NM109 -> 9)."""
    return seg[idx] if idx < len(seg) and seg[idx] != "" else default


def split_composite(value, comp_sep):
    return value.split(comp_sep) if value else []


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------
def validate(segments):
    errors = []
    ids = [s[0] for s in segments]

    if ids[0] != "ISA" or ids[-1] != "IEA":
        errors.append("Interchange must start with ISA and end with IEA")
    if "GS" not in ids or "GE" not in ids:
        errors.append("Missing GS/GE functional group envelope")

    # ISA/IEA and GS/GE control numbers
    isa = segments[0]
    iea = segments[-1]
    if get(isa, 13) != get(iea, 2):
        errors.append(f"ISA13/IEA02 control number mismatch: {get(isa, 13)} vs {get(iea, 2)}")

    # ST/SE checks
    st_indexes = [i for i, s in enumerate(segments) if s[0] == "ST"]
    for st_i in st_indexes:
        st = segments[st_i]
        se_i = next((i for i in range(st_i, len(segments)) if segments[i][0] == "SE"), None)
        if se_i is None:
            errors.append(f"ST {get(st, 2)} has no matching SE")
            continue
        se = segments[se_i]
        actual = se_i - st_i + 1
        if get(se, 1) != str(actual):
            errors.append(f"SE01 segment count is {get(se, 1)}, actual is {actual}")
        if get(st, 2) != get(se, 2):
            errors.append(f"ST02/SE02 control number mismatch: {get(st, 2)} vs {get(se, 2)}")
        if get(st, 1) != "278":
            errors.append(f"ST01 is {get(st, 1)}, expected 278")

    # HL hierarchy
    seen = set()
    for s in segments:
        if s[0] == "HL":
            hl_id, parent = get(s, 1), get(s, 2)
            if parent and parent not in seen:
                errors.append(f"HL {hl_id} references unknown parent {parent}")
            seen.add(hl_id)
    return errors


# --------------------------------------------------------------------------
# Transaction extraction
# --------------------------------------------------------------------------
def build_hierarchy(segments, comp_sep):
    """Walk the segments between ST and SE, grouping them under each HL loop."""
    result = {"header": {}, "loops": []}
    current = None

    for seg in segments:
        tag = seg[0]

        if tag == "BHT":
            result["header"] = {
                "structure_code": get(seg, 1),
                "purpose": {"13": "Request", "11": "Response"}.get(get(seg, 2), get(seg, 2)),
                "submitter_trace": get(seg, 3),
                "date": get(seg, 4),
                "time": get(seg, 5),
            }

        elif tag == "HL":
            level_code = get(seg, 3)
            current = {
                "id": get(seg, 1),
                "parent": get(seg, 2) or None,
                "level_code": level_code,
                "level": HL_LEVELS.get(level_code, f"unknown({level_code})"),
                "has_children": get(seg, 4) == "1",
            }
            result["loops"].append(current)

        elif current is None:
            continue  # envelope segments before the first HL

        elif tag == "NM1":
            current["name"] = {
                "entity_code": get(seg, 1),
                "is_organization": get(seg, 2) == "2",
                "last_or_org": get(seg, 3),
                "first": get(seg, 4),
                "id_qualifier": get(seg, 8),
                "id": get(seg, 9),
            }

        elif tag == "DMG":
            current["demographics"] = {"dob": get(seg, 2), "gender": get(seg, 3)}

        elif tag == "TRN":
            current.setdefault("trace_numbers", []).append(
                {"type": get(seg, 1), "trace": get(seg, 2), "originator": get(seg, 3)}
            )

        elif tag == "UM":
            svc = split_composite(get(seg, 4), comp_sep)
            current["utilization_management"] = {
                "request_category": get(seg, 1),
                "certification_type": get(seg, 2),
                "service_type": get(seg, 3),
                "facility_type": svc[0] if svc else "",
                "facility_qualifier": svc[1] if len(svc) > 1 else "",
            }

        elif tag == "DTP":
            current.setdefault("dates", []).append(
                {"qualifier": get(seg, 1), "format": get(seg, 2), "value": get(seg, 3)}
            )

        elif tag == "HI":
            diagnoses = []
            for i in range(1, len(seg)):
                parts = split_composite(seg[i], comp_sep)
                if len(parts) >= 2:
                    diagnoses.append({"qualifier": parts[0], "code": parts[1]})
            current.setdefault("diagnoses", []).extend(diagnoses)

        elif tag in ("SV1", "SV2", "SV3"):
            proc = split_composite(get(seg, 1 if tag == "SV1" else 2), comp_sep)
            current.setdefault("services", []).append(
                {
                    "segment": tag,
                    "code_qualifier": proc[0] if proc else "",
                    "procedure_code": proc[1] if len(proc) > 1 else "",
                    "quantity": (get(seg, 4) or get(seg, 7) or get(seg, 6)) if tag == "SV1" else (get(seg, 5) or get(seg, 6)),
                }
            )

    return result


def process_file(path):
    with open(path, "r", encoding="utf-8") as fh:
        raw = fh.read()

    segments, elem_sep, comp_sep, seg_term = parse_segments(raw)
    errors = validate(segments)

    isa, gs = segments[0], next(s for s in segments if s[0] == "GS")
    st_i = next(i for i, s in enumerate(segments) if s[0] == "ST")
    se_i = next(i for i, s in enumerate(segments) if s[0] == "SE")

    transaction = build_hierarchy(segments[st_i:se_i + 1], comp_sep)

    return {
        "file": path,
        "envelope": {
            "sender_id": get(isa, 6).strip(),
            "receiver_id": get(isa, 8).strip(),
            "usage": {"T": "Test", "P": "Production"}.get(get(isa, 15), get(isa, 15)),
            "interchange_control": get(isa, 13),
            "group_function": get(gs, 1),
            "version": get(gs, 8),
        },
        "validation_errors": errors,
        "transaction": transaction,
    }


# --------------------------------------------------------------------------
# Output
# --------------------------------------------------------------------------
def print_summary(data):
    env, txn = data["envelope"], data["transaction"]
    print(f"File:      {data['file']}")
    print(f"From/To:   {env['sender_id']} -> {env['receiver_id']} ({env['usage']})")
    print(f"Version:   {env['version']}  |  Purpose: {txn['header'].get('purpose')}")
    print(f"Created:   {txn['header'].get('date')} {txn['header'].get('time')}")
    print()

    if data["validation_errors"]:
        print("VALIDATION ERRORS:")
        for e in data["validation_errors"]:
            print(f"  - {e}")
    else:
        print("Validation: OK")
    print()

    for loop in txn["loops"]:
        indent = "  " * (int(loop["id"]) - 1)
        nm = loop.get("name", {})
        who = " ".join(x for x in (nm.get("first", ""), nm.get("last_or_org", "")) if x)
        print(f"{indent}[HL {loop['id']}] {loop['level'].upper()}: {who} ({nm.get('id', '')})")
        if "demographics" in loop:
            d = loop["demographics"]
            print(f"{indent}    DOB {d['dob']}, gender {d['gender']}")
        for dx in loop.get("diagnoses", []):
            print(f"{indent}    Dx {dx['code']} ({dx['qualifier']})")
        if "utilization_management" in loop:
            u = loop["utilization_management"]
            print(f"{indent}    UM: category={u['request_category']} cert={u['certification_type']} "
                  f"service_type={u['service_type']} place={u['facility_type']}")
        for svc in loop.get("services", []):
            print(f"{indent}    Service {svc['procedure_code']} qty {svc['quantity']}")
        for dt in loop.get("dates", []):
            print(f"{indent}    Date [{dt['qualifier']}] {dt['value']}")
        for t in loop.get("trace_numbers", []):
            print(f"{indent}    Trace {t['trace']}")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    data = process_file(sys.argv[1])
    if "--json" in sys.argv:
        print(json.dumps(data, indent=2))
    else:
        print_summary(data)


if __name__ == "__main__":
    main()
