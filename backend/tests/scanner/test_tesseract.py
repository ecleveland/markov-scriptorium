"""The Tesseract adapter without the binary (VEG-649, ADR 0028).

``subprocess.run`` is replaced with a fake that records what the adapter sent
and answers with a TSV the test wrote, so the image prep, the TSV parsing and
the box mapping are held without Tesseract installed.
"""

from __future__ import annotations

import io
import logging
import random
import struct
import subprocess
from dataclasses import dataclass, field

import pytest
from PIL import Image, ImageDraw

from scriptorium.scanner.engines import tesseract as engine_module
from scriptorium.scanner.engines.tesseract import (
    PixelBox,
    TesseractOcr,
    Word,
    find_tesseract,
    group_lines,
    parse_tsv,
    prepare,
    probe,
    to_frame,
)
from scriptorium.scanner.ocr import Box, OcrUnavailable, UnreadableImage
from scriptorium.scanner.region import title_region
from tests.scanner.drawn import HEIGHT, WIDTH, png

BINARY = "/opt/test/bin/tesseract"
RUN = "scriptorium.scanner.engines.tesseract.subprocess.run"
HEADER = "\t".join(
    ["level", "page_num", "block_num", "par_num", "line_num", "word_num"]
    + ["left", "top", "width", "height", "conf", "text"]
)
# What tesseract 5.5.4 prints when the eng model is missing. The language line
# is not the last one, which is why the adapter keeps more than one.
NO_ENG = (
    "Error opening data file /opt/homebrew/share/tessdata/eng.traineddata\n"
    'Please make sure the TESSDATA_PREFIX environment variable is set to your "tessdata" '
    "directory.\n"
    "Failed loading language 'eng'\n"
    "Tesseract couldn't load any languages!\n"
    "Could not initialize tesseract.\n"
)


def word_row(
    block: int,
    line: int,
    word: int,
    box: tuple[int, int, int, int],
    conf: float,
    text: str,
    par: int = 1,
) -> str:
    left, top, width, height = box
    return f"5\t1\t{block}\t{par}\t{line}\t{word}\t{left}\t{top}\t{width}\t{height}\t{conf}\t{text}"


def tsv(*rows: str) -> str:
    # Tesseract writes the page, block, paragraph and line rows too, with conf
    # -1 and no text. One of each keeps the parser honest about levels.
    structure = [
        "1\t1\t0\t0\t0\t0\t0\t0\t1280\t960\t-1\t",
        "2\t1\t1\t0\t0\t0\t10\t10\t500\t100\t-1\t",
        "3\t1\t1\t1\t0\t0\t10\t10\t500\t100\t-1\t",
        "4\t1\t1\t1\t1\t0\t10\t10\t500\t40\t-1\t",
    ]
    return "\n".join([HEADER, *structure, *rows]) + "\n"


@dataclass
class FakeRun:
    """Stands in for subprocess.run and keeps every call it was given."""

    stdout: str = ""
    returncode: int = 0
    stderr: str = ""
    raises: BaseException | None = None
    calls: list[tuple[list[str], dict[str, object]]] = field(default_factory=list)

    def __call__(self, argv: list[str], **kwargs: object) -> subprocess.CompletedProcess[bytes]:
        self.calls.append((argv, kwargs))
        if self.raises is not None:
            raise self.raises
        return subprocess.CompletedProcess(
            argv, self.returncode, self.stdout.encode(), self.stderr.encode()
        )

    def stdin_image(self, call: int = 0) -> Image.Image:
        data = self.calls[call][1]["input"]
        assert isinstance(data, bytes)
        return Image.open(io.BytesIO(data))


@pytest.fixture
def fake_run(monkeypatch: pytest.MonkeyPatch) -> FakeRun:
    fake = FakeRun(stdout=tsv())
    monkeypatch.setattr(RUN, fake)
    return fake


def frame(marker: tuple[int, int, int, int] | None = None) -> Image.Image:
    """A blank 1280x960 frame, with a black block at ``marker`` if given.

    No text and no outline. Autocontrast stretches any grey to black, which
    would hide whether the marker reached the crop.
    """
    img = Image.new("RGB", (WIDTH, HEIGHT), "white")
    if marker is not None:
        ImageDraw.Draw(img).rectangle(marker, fill="black")
    return img


# --- argv and stdin -----------------------------------------------------------


def expected_argv(psm: str) -> list[str]:
    return [
        BINARY,
        "stdin",
        "stdout",
        "-l",
        "eng",
        "--oem",
        "1",
        "--psm",
        psm,
        "-c",
        "tessedit_create_tsv=1",
    ]


def test_a_region_read_runs_tesseract_as_one_block(fake_run: FakeRun) -> None:
    TesseractOcr(BINARY).read_lines(png(frame()), region=title_region())
    argv, kwargs = fake_run.calls[0]
    assert argv == expected_argv("6")
    stdin = kwargs["input"]
    assert isinstance(stdin, bytes)
    assert stdin.startswith(b"\x89PNG\r\n\x1a\n")
    env = kwargs["env"]
    assert isinstance(env, dict)
    assert env["OMP_THREAD_LIMIT"] == "1"
    assert kwargs["timeout"] == 10
    assert kwargs["capture_output"] is True
    # The Windows sidecar must never flash a console. Elsewhere the flag is 0.
    assert kwargs["creationflags"] == getattr(subprocess, "CREATE_NO_WINDOW", 0)


def test_a_whole_frame_read_runs_tesseract_as_sparse_text(fake_run: FakeRun) -> None:
    TesseractOcr(BINARY).read_lines(png(frame()))
    argv, kwargs = fake_run.calls[0]
    assert argv == expected_argv("11")
    env = kwargs["env"]
    assert isinstance(env, dict)
    assert env["OMP_THREAD_LIMIT"] == "1"
    assert kwargs["timeout"] == 10


def test_a_region_off_the_frame_reads_nothing_without_running(fake_run: FakeRun) -> None:
    ocr = TesseractOcr(BINARY)
    assert ocr.read_lines(png(frame()), region=Box(x=1.2, y=0.0, width=0.3, height=0.3)) == []
    assert ocr.read_lines(png(frame()), region=Box(x=0.2, y=0.5, width=0.0, height=0.3)) == []
    assert fake_run.calls == []


# --- the TSV ------------------------------------------------------------------


def test_two_words_on_one_line_join_and_their_boxes_unite() -> None:
    words = parse_tsv(
        tsv(
            word_row(1, 1, 1, (100, 50, 120, 40), 90, "Edgar"),
            word_row(1, 1, 2, (240, 45, 150, 50), 80, "Markov"),
        )
    )
    assert group_lines(words) == [("Edgar Markov", 0.85, PixelBox(100, 45, 290, 50))]


def test_rows_without_a_confidence_are_dropped() -> None:
    words = parse_tsv(
        tsv(
            word_row(1, 1, 1, (100, 50, 120, 40), 90, "Edgar"),
            word_row(1, 1, 2, (240, 50, 30, 40), -1, "~"),
        )
    )
    assert [w.text for w in words] == ["Edgar"]


def test_a_word_with_blank_text_is_dropped() -> None:
    words = parse_tsv(
        tsv(
            word_row(1, 1, 1, (100, 50, 120, 40), 90, "Edgar"),
            word_row(1, 1, 2, (240, 50, 30, 40), 95, " "),
        )
    )
    assert [w.text for w in words] == ["Edgar"]


def test_two_lines_in_one_block_come_back_in_order() -> None:
    words = parse_tsv(
        tsv(
            word_row(1, 1, 1, (100, 50, 200, 40), 96, "Edgar"),
            word_row(1, 2, 1, (100, 400, 300, 30), 70, "Vampire"),
        )
    )
    assert [text for text, _, _ in group_lines(words)] == ["Edgar", "Vampire"]


def test_the_same_line_number_in_another_block_is_another_line() -> None:
    words = parse_tsv(
        tsv(
            word_row(1, 1, 1, (100, 50, 200, 40), 96, "Edgar"),
            word_row(2, 1, 1, (100, 400, 300, 30), 70, "Vampire"),
        )
    )
    assert len(group_lines(words)) == 2


def test_the_same_line_number_in_another_paragraph_is_another_line() -> None:
    words = parse_tsv(
        tsv(
            word_row(1, 1, 1, (100, 50, 200, 40), 96, "Edgar", par=1),
            word_row(1, 1, 1, (100, 400, 300, 30), 70, "Vampire", par=2),
        )
    )
    assert [text for text, _, _ in group_lines(words)] == ["Edgar", "Vampire"]


def test_parse_tsv_keeps_every_field_of_a_word() -> None:
    words = parse_tsv(tsv(word_row(2, 3, 1, (11, 22, 33, 44), 91.5, "Markov", par=4)))
    assert words == [Word(2, 4, 3, "Markov", 91.5, 11, 22, 33, 44)]


def test_a_row_that_will_not_parse_is_skipped() -> None:
    words = parse_tsv(
        tsv(
            word_row(1, 1, 1, (100, 50, 120, 40), 90, "Edgar"),
            word_row(1, 1, 2, (240, 50, 30, 40), 90, "Markov").replace("\t90\t", "\t96,5\t"),
            word_row(1, 1, 3, (300, 50, 30, 40), 80, "Vampire"),
        )
    )
    assert [w.text for w in words] == ["Edgar", "Vampire"]


def test_a_header_only_tsv_reads_no_lines() -> None:
    assert group_lines(parse_tsv(HEADER + "\n")) == []
    assert parse_tsv("") == []


def test_confidence_is_the_mean_word_confidence_over_100() -> None:
    words = parse_tsv(
        tsv(
            word_row(1, 1, 1, (0, 0, 10, 10), 60, "a"),
            word_row(1, 1, 2, (20, 0, 10, 10), 90, "b"),
            word_row(1, 1, 3, (40, 0, 10, 10), 99, "c"),
        )
    )
    (_, confidence, _) = group_lines(words)[0]
    assert confidence == pytest.approx(0.83)


# --- geometry -----------------------------------------------------------------


def region_pixels(region: Box) -> tuple[int, int, int, int]:
    return (
        round(region.x * WIDTH),
        round(region.y * HEIGHT),
        round((region.x + region.width) * WIDTH),
        round((region.y + region.height) * HEIGHT),
    )


def answer_with_word_at(
    fake: FakeRun, crop: Image.Image, at: tuple[int, int, int, int]
) -> tuple[int, int, int, int]:
    """Make the fake answer with one word at ``at`` in crop pixels; return its prepared box."""
    prepared = prepare(crop)
    left, top, width, height = at
    box = (
        round(prepared.border + left * prepared.scale),
        round(prepared.border + top * prepared.scale),
        round(width * prepared.scale),
        round(height * prepared.scale),
    )
    fake.stdout = tsv(word_row(1, 1, 1, box, 95, "Edgar"))
    return box


def as_tuple(box: Box) -> tuple[float, float, float, float]:
    return (box.x, box.y, box.width, box.height)


def test_a_title_region_box_maps_back_to_the_frame(fake_run: FakeRun) -> None:
    img = frame()
    x0, y0, x1, y1 = region_pixels(title_region())
    answer_with_word_at(fake_run, img.crop((x0, y0, x1, y1)), (100, 50, 200, 40))
    (line,) = TesseractOcr(BINARY).read_lines(png(img), region=title_region())
    want = ((x0 + 100) / WIDTH, (y0 + 50) / HEIGHT, 200 / WIDTH, 40 / HEIGHT)
    assert as_tuple(line.box) == pytest.approx(want, abs=1e-3)
    assert line.text == "Edgar"
    assert line.confidence == pytest.approx(0.95)


def test_a_whole_frame_box_maps_back_to_the_frame(fake_run: FakeRun) -> None:
    img = frame()
    answer_with_word_at(fake_run, img, (300, 500, 400, 30))
    (line,) = TesseractOcr(BINARY).read_lines(png(img))
    want = (300 / WIDTH, 500 / HEIGHT, 400 / WIDTH, 30 / HEIGHT)
    assert as_tuple(line.box) == pytest.approx(want, abs=1e-3)


def test_an_upside_down_title_region_box_is_in_the_turned_frame(fake_run: FakeRun) -> None:
    img = frame()
    x0, y0, x1, y1 = region_pixels(title_region())
    answer_with_word_at(fake_run, img.crop((x0, y0, x1, y1)), (100, 50, 200, 40))
    (line,) = TesseractOcr(BINARY).read_lines(
        png(img.rotate(180)), upside_down=True, region=title_region()
    )
    want = ((x0 + 100) / WIDTH, (y0 + 50) / HEIGHT, 200 / WIDTH, 40 / HEIGHT)
    assert as_tuple(line.box) == pytest.approx(want, abs=1e-3)


# A black block at the bottom of the frame, inside the title region's column.
# Turned half a turn it lands at the top, inside the title region.
MARKER = (600, 900, 680, 950)


def test_an_upside_down_read_crops_from_the_turned_frame(fake_run: FakeRun) -> None:
    ocr = TesseractOcr(BINARY)
    img = frame(MARKER)
    ocr.read_lines(png(img), region=title_region())
    ocr.read_lines(png(img), upside_down=True, region=title_region())
    upright, turned = fake_run.stdin_image(0).convert("L"), fake_run.stdin_image(1).convert("L")
    # Upright, the marker sits below the title region, so the crop holds none of it.
    darkest = upright.getextrema()[0]
    assert isinstance(darkest, int)
    assert darkest > 64
    # Turned, the marker spans x 599 to 679 and y 9 to 59 of the frame. Find its
    # centre in the prepared crop and check it is dark there.
    x0, y0, x1, y1 = region_pixels(title_region())
    left, top, right, bottom = 1279 - MARKER[2], 959 - MARKER[3], 1279 - MARKER[0], 959 - MARKER[1]
    prepared = prepare(img.crop((x0, y0, x1, y1)))
    cx = prepared.border + ((left + right) / 2 - x0) * prepared.scale
    cy = prepared.border + ((top + bottom) / 2 - y0) * prepared.scale
    pixel = turned.getpixel((round(cx), round(cy)))
    assert isinstance(pixel, int)
    assert pixel < 64


def test_a_region_past_the_left_and_bottom_edges_is_cropped_to_the_frame(
    fake_run: FakeRun,
) -> None:
    # Clamped, the region is the frame's bottom-left 0.2 by 0.2.
    TesseractOcr(BINARY).read_lines(png(frame()), region=Box(-0.1, 0.8, 0.3, 0.4))
    width, height = round(0.2 * WIDTH), round(0.2 * HEIGHT)
    prepared = prepare(Image.new("L", (width, height), 255))
    border = 2 * prepared.border
    expected = (round(width * prepared.scale) + border, round(height * prepared.scale) + border)
    assert fake_run.stdin_image().size == expected


def test_to_frame_undoes_the_border_and_the_scale() -> None:
    box = to_frame(PixelBox(70, 120, 200, 50), 2.5, 20, (100, 30), (1000, 500))
    assert as_tuple(box) == pytest.approx((0.12, 0.14, 0.08, 0.04))


def test_a_box_reaching_into_the_border_is_clamped_to_the_frame() -> None:
    # Tesseract can report a box that starts in the white margin.
    box = to_frame(PixelBox(10, 5, 50, 30), 1.0, 20, (0, 0), (1000, 500))
    assert as_tuple(box) == pytest.approx((0.0, 0.0, 0.04, 0.03))


def test_a_box_past_the_far_edge_is_clamped_to_the_frame() -> None:
    box = to_frame(PixelBox(1000, 500, 60, 40), 1.0, 20, (0, 0), (1000, 500))
    assert as_tuple(box) == pytest.approx((0.98, 0.96, 0.02, 0.04))
    assert box.x + box.width <= 1
    assert box.y + box.height <= 1


def test_prepare_upscales_a_short_crop_and_adds_a_white_border() -> None:
    crop = Image.new("RGB", (300, 120), "white")
    prepared = prepare(crop)
    assert prepared.scale == 4.0
    assert prepared.border == 20
    out = Image.open(io.BytesIO(prepared.png))
    assert out.format == "PNG"
    assert out.size == (300 * 4 + 40, 120 * 4 + 40)


def test_prepare_caps_the_upscale_at_four() -> None:
    # 480 over 60 would be 8.
    prepared = prepare(Image.new("RGB", (300, 60), "white"))
    assert prepared.scale == 4.0
    assert Image.open(io.BytesIO(prepared.png)).size == (1240, 280)


def test_prepare_leaves_a_tall_crop_at_its_size() -> None:
    prepared = prepare(Image.new("RGB", (1280, 960), "white"))
    assert prepared.scale == 1.0
    assert Image.open(io.BytesIO(prepared.png)).size == (1320, 1000)


def test_prepare_hands_tesseract_a_greyscale_image() -> None:
    crop = Image.new("RGB", (300, 120), (200, 30, 30))
    assert Image.open(io.BytesIO(prepare(crop).png)).mode == "L"


# --- errors -------------------------------------------------------------------


@pytest.mark.parametrize(
    "fake",
    [
        FakeRun(raises=FileNotFoundError(BINARY)),
        FakeRun(raises=PermissionError(BINARY)),
        FakeRun(raises=subprocess.TimeoutExpired(BINARY, 10)),
        FakeRun(returncode=1, stderr=NO_ENG),
    ],
    ids=["missing binary", "not executable", "timeout", "non-zero exit"],
)
def test_a_failed_run_is_an_engine_failure_and_is_logged(
    fake: FakeRun, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(RUN, fake)
    with caplog.at_level(logging.ERROR), pytest.raises(OcrUnavailable):
        TesseractOcr(BINARY).read_lines(png(frame()), region=title_region())
    assert any(r.levelname == "ERROR" and BINARY in r.getMessage() for r in caplog.records)


def test_a_missing_language_reaches_the_failure_message(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(RUN, FakeRun(returncode=1, stderr=NO_ENG))
    with pytest.raises(OcrUnavailable, match="Failed loading language 'eng'"):
        TesseractOcr(BINARY).read_lines(png(frame()))


def test_the_failure_message_keeps_the_last_five_lines_of_stderr(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stderr = "Warning: first noise\nWarning: second noise\n\n" + NO_ENG
    monkeypatch.setattr(RUN, FakeRun(returncode=1, stderr=stderr))
    with pytest.raises(OcrUnavailable) as caught:
        TesseractOcr(BINARY).read_lines(png(frame()))
    message = str(caught.value)
    assert "Could not initialize tesseract" in message
    assert "Error opening data file" in message
    assert "second noise" not in message
    assert "first noise" not in message


def test_bytes_pillow_cannot_decode_are_unreadable_before_any_run(fake_run: FakeRun) -> None:
    with pytest.raises(UnreadableImage):
        TesseractOcr(BINARY).read_lines(b"\xff\xd8\xff" + b"\x00" * 16)
    with pytest.raises(UnreadableImage):
        TesseractOcr(BINARY).read_lines(b"\x89PNG\r\n\x1a\n" + b"Edgar Markov is a vampire" * 4)
    assert fake_run.calls == []


def noise_png() -> bytes:
    """A PNG big enough after compression that Pillow writes several IDAT chunks."""
    noise = random.Random(649).randbytes(300 * 300 * 3)
    return png(Image.frombytes("RGB", (300, 300), noise))


def chunk_offsets(data: bytes) -> list[tuple[bytes, int]]:
    """Each chunk's type and the offset of its length field."""
    offsets: list[tuple[bytes, int]] = []
    pos = 8
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        offsets.append((data[pos + 4 : pos + 8], pos))
        pos += 12 + length
    return offsets


def test_a_png_broken_between_its_data_chunks_is_unreadable(fake_run: FakeRun) -> None:
    data = bytearray(noise_png())
    idats = [pos for kind, pos in chunk_offsets(bytes(data)) if kind == b"IDAT"]
    assert len(idats) > 1
    # A chunk type that is not letters makes Pillow raise SyntaxError on load.
    data[idats[1] + 4 : idats[1] + 8] = b"\x00\x00\x00\x00"
    with pytest.raises(UnreadableImage):
        TesseractOcr(BINARY).read_lines(bytes(data))
    assert fake_run.calls == []


def test_a_jpeg_cut_in_half_is_unreadable(fake_run: FakeRun) -> None:
    out = io.BytesIO()
    Image.open(io.BytesIO(noise_png())).save(out, format="JPEG")
    jpeg = out.getvalue()
    with pytest.raises(UnreadableImage):
        TesseractOcr(BINARY).read_lines(jpeg[: len(jpeg) // 2])
    assert fake_run.calls == []


def encoded(img: Image.Image, fmt: str) -> bytes:
    out = io.BytesIO()
    img.save(out, format=fmt)
    return out.getvalue()


@pytest.mark.parametrize(
    "image",
    [
        encoded(frame().convert("RGBA"), "PNG"),
        encoded(frame().convert("P"), "PNG"),
        encoded(frame().convert("CMYK"), "JPEG"),
    ],
    ids=["RGBA", "palette", "CMYK"],
)
def test_any_colour_mode_reaches_tesseract_as_a_greyscale_png(
    image: bytes, fake_run: FakeRun
) -> None:
    TesseractOcr(BINARY).read_lines(image, region=title_region())
    assert len(fake_run.calls) == 1
    sent = fake_run.stdin_image()
    assert sent.format == "PNG"
    assert sent.mode == "L"


def test_a_mode_pillow_cannot_grey_is_unreadable_before_any_run(fake_run: FakeRun) -> None:
    # Pillow decodes a LAB TIFF but cannot convert LAB to L.
    lab = encoded(Image.new("LAB", (8, 8)), "TIFF")
    with pytest.raises(UnreadableImage):
        TesseractOcr(BINARY).read_lines(lab)
    assert fake_run.calls == []


def test_an_image_over_the_pixel_cap_is_unreadable_before_any_run(
    fake_run: FakeRun, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 49 million pixels. One bit per pixel keeps the PNG to a few KB.
    huge = png(Image.new("1", (7000, 7000), 1))

    def refuse(self: object) -> None:
        raise AssertionError("decoded before the pixel cap was checked")

    # PNG decodes through ImageFile.load, so this proves the cap reads the header.
    monkeypatch.setattr("PIL.ImageFile.ImageFile.load", refuse)
    with pytest.raises(UnreadableImage, match="pixels"):
        TesseractOcr(BINARY).read_lines(huge)
    assert fake_run.calls == []


def test_a_decompression_bomb_is_unreadable(
    fake_run: FakeRun, monkeypatch: pytest.MonkeyPatch
) -> None:
    def bomb(*args: object, **kwargs: object) -> Image.Image:
        raise Image.DecompressionBombError("too many pixels")

    monkeypatch.setattr("scriptorium.scanner.engines.tesseract.Image.open", bomb)
    with pytest.raises(UnreadableImage):
        TesseractOcr(BINARY).read_lines(png(frame()))
    assert fake_run.calls == []


def test_tesseract_does_not_claim_to_read_corners() -> None:
    assert TesseractOcr(BINARY).reads_corners is False


# --- probe --------------------------------------------------------------------

LANGS = 'List of available languages in "/opt/homebrew/share/tessdata/" (2):\neng\nosd\n'


def test_probe_lists_the_languages_with_a_short_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeRun(stdout=LANGS)
    monkeypatch.setattr(RUN, fake)
    probe(BINARY)
    argv, kwargs = fake.calls[0]
    assert argv == [BINARY, "--list-langs"]
    assert kwargs["timeout"] == 5
    assert kwargs["creationflags"] == getattr(subprocess, "CREATE_NO_WINDOW", 0)


def test_probe_finds_eng_listed_on_stderr(monkeypatch: pytest.MonkeyPatch) -> None:
    # Tesseract before 5 printed the list to stderr.
    monkeypatch.setattr(RUN, FakeRun(stderr=LANGS))
    probe(BINARY)


def test_probe_without_eng_says_the_model_is_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    langs = 'List of available languages in "/usr/share/tessdata/" (2):\nosd\nengrestrict\n'
    monkeypatch.setattr(RUN, FakeRun(stdout=langs))
    with pytest.raises(OcrUnavailable, match=f"{BINARY} has no eng model"):
        probe(BINARY)


def test_probe_that_exits_non_zero_says_so(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(RUN, FakeRun(stdout=LANGS, returncode=1))
    with pytest.raises(OcrUnavailable, match=f"{BINARY} exited 1 while listing languages"):
        probe(BINARY)


@pytest.mark.parametrize(
    "fake",
    [
        FakeRun(raises=FileNotFoundError(BINARY)),
        FakeRun(raises=PermissionError(BINARY)),
        FakeRun(raises=subprocess.TimeoutExpired(BINARY, 5)),
    ],
    ids=["missing binary", "not executable", "timeout"],
)
def test_probe_of_a_binary_that_will_not_run_says_so(
    fake: FakeRun, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(RUN, fake)
    with pytest.raises(OcrUnavailable, match=f"{BINARY} would not run or timed out"):
        probe(BINARY)


# --- the conftest guard -------------------------------------------------------


def test_the_guard_refuses_a_real_read_outside_the_marker() -> None:
    with pytest.raises(AssertionError, match="real Tesseract"):
        TesseractOcr(BINARY).read_lines(png(frame()))


def test_the_guard_refuses_a_real_probe_outside_the_marker() -> None:
    # Looked up on the module at call time, as selection does, because the
    # guard replaces the module's attribute.
    with pytest.raises(AssertionError, match="real Tesseract"):
        engine_module.probe(BINARY)


# --- find_tesseract -----------------------------------------------------------


def test_the_env_setting_wins_over_the_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SCRIPTORIUM_TESSERACT", " /custom/tesseract ")
    monkeypatch.setattr("shutil.which", lambda name: "/usr/bin/tesseract")
    assert find_tesseract() == "/custom/tesseract"


def test_a_blank_env_setting_falls_back_to_the_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SCRIPTORIUM_TESSERACT", "  ")
    monkeypatch.setattr("shutil.which", lambda name: f"/usr/bin/{name}")
    assert find_tesseract() == "/usr/bin/tesseract"


def test_no_setting_and_nothing_on_the_path_finds_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SCRIPTORIUM_TESSERACT", raising=False)
    monkeypatch.setattr("shutil.which", lambda name: None)
    assert find_tesseract() is None
