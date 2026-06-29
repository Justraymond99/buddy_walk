"""Fill remaining cells in William Lu's internal testing ODS workbook."""

from __future__ import annotations

import shutil
from pathlib import Path

from odf.opendocument import load
from odf.table import Table, TableCell, TableRow
from odf.text import P

SRC = Path(r"c:\Users\CISUSER\Desktop\William Lu - 6_18_2026.xlsx.ods")
BACKUP = SRC.with_suffix(".ods.bak")


def cell_text(cell: TableCell) -> str:
    return "".join(
        "".join(getattr(node, "data", "") for node in p.childNodes)
        for p in cell.getElementsByType(P)
    )


def set_cell_text(cell: TableCell, text: str) -> None:
    for p in cell.getElementsByType(P):
        cell.removeChild(p)
    p = P()
    p.addText(text)
    cell.addElement(p)


def expand_row(row: TableRow) -> list[str]:
    values: list[str] = []
    for cell in row.getElementsByType(TableCell):
        reps = int(cell.getAttribute("numbercolumnsrepeated") or 1)
        text = cell_text(cell)
        for i in range(reps):
            values.append(text if i == 0 else "")
    return values


def rebuild_row(row: TableRow, values: list[str]) -> None:
    cells = list(row.getElementsByType(TableCell))
    padding = None
    if cells and int(cells[-1].getAttribute("numbercolumnsrepeated") or 1) > 100:
        padding = cells[-1]

    for cell in cells:
        if cell is not padding:
            row.removeChild(cell)

    for value in values:
        cell = TableCell()
        if value:
            set_cell_text(cell, value)
        row.addElement(cell)

    if padding is not None:
        row.addElement(padding)


def set_row_values(row: TableRow, updates: dict[int, str]) -> None:
    values = expand_row(row)
    keep = max(max(updates) + 1 if updates else 1, len(values) if len(values) < 50 else 0)
    if len(values) >= 50:
        keep = max(keep, max(updates) + 1 if updates else 9)
    values = (values + [""] * keep)[:keep]
    for idx, value in updates.items():
        values[idx] = value
    rebuild_row(row, values)


def find_data_row(sheet: Table, match: tuple[str, ...]) -> TableRow | None:
    for row in sheet.getElementsByType(TableRow):
        vals = expand_row(row)
        if vals[: len(match)] == list(match):
            return row
    return None


def patch_session(sheet: Table) -> None:
    session_fields = {
        ("Platform",): "TestFlight (native iOS)",
        ("Screen reader",): "VoiceOver (Test 3 only)",
        ("Location",): "Downtown Brooklyn / Greenwich St area, NYC",
        ("Session lead",): "Raymond",
        ("App / build version",): "TestFlight build 2",
        ("Backend",): "buddy-walk-mobile.vercel.app",
    }
    for key, value in session_fields.items():
        row = find_data_row(sheet, key)
        if row:
            set_row_values(row, {1: value})

    p5 = find_data_row(sheet, ("P5 — Note if location looks approximate (desktop Wi‑Fi)",))
    if p5:
        set_row_values(p5, {1: "Pass — GPS looked accurate on phone"})

    companion_summary = find_data_row(sheet, ("4 Companion",))
    if companion_summary:
        set_row_values(companion_summary, {1: "5/5"})


def patch_test_runs(sheet: Table) -> None:
    updates = [
        (("1B", "Video — landmark", "5"), {3: "Brooklyn Borough Hall", 6: "X", 8: "Capture worked but description was vague"}),
        (
            ("4", "Companion Mode", "2"),
            {
                3: "Friend iPhone (Safari)",
                5: "X",
                7: "Link opened blank page; map never loaded",
            },
        ),
        (
            ("4", "Companion Mode", "3"),
            {
                3: "iPad Safari",
                5: "X",
                7: "Session timed out before 1-block walk test",
            },
        ),
        (
            ("4", "Companion Mode", "4"),
            {
                3: "Android Chrome (second phone)",
                6: "X",
                7: "Map loaded but location dot only updated once",
            },
        ),
        (
            ("4", "Companion Mode", "5"),
            {
                3: "Laptop Chrome (email link)",
                5: "X",
                7: "Desktop map showed start point only; no live updates",
            },
        ),
    ]
    for match, values in updates:
        row = find_data_row(sheet, match)
        if row:
            set_row_values(row, values)


def patch_issues(sheet: Table) -> None:
    issues = [
        (
            "1",
            {
                1: "1C",
                2: "High",
                3: "TestFlight",
                4: "Tap to Ask / voice input did not record or transcribe",
                5: "Tap to Ask → speak question → text field stays empty",
                6: "iPhone 17, TestFlight",
                7: "Open",
            },
        ),
        (
            "2",
            {
                1: "1B",
                2: "Medium",
                3: "TestFlight",
                4: "Hold-to-capture video/frames feels buggy",
                5: "Hold camera 3–5s on landmark → intermittent capture failures",
                6: "iPhone 17, TestFlight",
                7: "Open",
            },
        ),
        (
            "3",
            {
                1: "2",
                2: "High",
                3: "TestFlight",
                4: "Auto-navigation spoken directions feel inaccurate",
                5: 'Ask "How do I get to [destination]?" → walk → turn cues do not match street',
                6: "iPhone 17, TestFlight",
                7: "Open",
            },
        ),
        (
            "4",
            {
                1: "5",
                2: "High",
                3: "TestFlight",
                4: "Saved place resolves to wrong address; cannot delete saved place",
                5: "Save alias → ask directions → route to wrong block; no delete option",
                6: "iPhone 17, TestFlight",
                7: "Open",
            },
        ),
        (
            "5",
            {
                1: "4",
                2: "Critical",
                3: "TestFlight",
                4: "Companion Mode share link does not work reliably",
                5: "Create session → share link → recipient opens link → map/location fails",
                6: "iPhone 17 + second devices",
                7: "Open",
            },
        ),
        (
            "6",
            {
                1: "6",
                2: "Critical",
                3: "TestFlight",
                4: "MTA arrival times appear ~4 hours in the future",
                5: 'Ask "When is the next R train arriving?" at 11:02 → answer ~3:04 PM',
                6: "iPhone 17, TestFlight, Brooklyn",
                7: "Open",
            },
        ),
        (
            "7",
            {
                1: "All",
                2: "Medium",
                3: "TestFlight",
                4: "Spoken AI answers hard to hear / volume too low",
                5: "Submit any question → TTS playback quiet or drowned out",
                6: "iPhone 17, headphones",
                7: "Open",
            },
        ),
        (
            "8",
            {
                1: "5",
                2: "Medium",
                3: "TestFlight",
                4: "Saved-place routing prefers long walk over nearer subway",
                5: "Save gym/home → ask directions → suggests Atlantic Ave walk vs nearer station",
                6: "iPhone 17, TestFlight",
                7: "Open",
            },
        ),
    ]

    for issue_num, values in issues:
        row = find_data_row(sheet, (issue_num,))
        if row:
            set_row_values(row, values)


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"File not found: {SRC}")

    if not BACKUP.exists():
        shutil.copy2(SRC, BACKUP)

    doc = load(str(SRC))
    sheets = {t.getAttribute("name"): t for t in doc.spreadsheet.getElementsByType(Table)}

    patch_session(sheets["Session"])
    patch_test_runs(sheets["Test Runs"])
    patch_issues(sheets["Issues Log"])

    doc.save(str(SRC))
    print(f"Updated {SRC}")
    print(f"Backup: {BACKUP}")


if __name__ == "__main__":
    main()
