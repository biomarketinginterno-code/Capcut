"""
estrategia_pdf.py -- Generador del PDF de estrategia BioMarketing (14 secciones)
=================================================================================
Pensado para correr DENTRO de ChatGPT via Code Interpreter, sin depender de
Node, del navegador ni de ningun paso manual. Solo necesita `reportlab`
(viene preinstalado en el entorno de Code Interpreter de ChatGPT).

Uso tipico (lo hace el propio agente GPT, no el usuario humano):

    from estrategia_pdf import generar_pdf, EJEMPLO
    generar_pdf(EJEMPLO, "estrategia_nora.pdf")
    # o con los datos reales de la conversacion:
    generar_pdf(data, "estrategia_<cliente>.pdf")

`data` es un diccionario con esta forma (ver EJEMPLO mas abajo, que es un
caso REAL y completo, para copiar la estructura exacta):

{
  "marca": str, "linea": str, "fecha": "DD.MM.AAAA", "anio": "AAAA",
  "palabras_clave": [str, str, str],
  "colores": {                      # SIEMPRE pedidos al cliente, nunca inventados
    "bg": "#RRGGBB", "primary": "#RRGGBB", "accent": "#RRGGBB",
    "card_a": "#RRGGBB", "card_b": "#RRGGBB", "on_primary": "#RRGGBB",
    "border": "#RRGGBB", "highlight": "#RRGGBB"
  },
  "portada": {"pill_a","pill_b","pill_c","duracion_meses","frase_espiritu"},
  "slide2": {"objetivo","hipotesis","aclaracion","que_no_es","que_si_es"},
  "slide3": {"intro","stats":[{"titulo","desc"}]*4,"momentos":[{"que","frase"}]*3},
  "slide4": {"activos":[{"titulo","desc"}]*6},
  "slide5": {"n_pilares","reparto","pilares":[{"titulo","desc"}]*6,"regla"},
  "slide6": {"n_piezas","intro","n_reels","reels":[{"pilar","que"}]*3 + [{"pilar"}],
             "n_placas","placas":[{"desc"}]*2,"tag_a","tag_b","tag_c"},
  "slide7": {"checklist":[str]*4,"lenguaje":{"duracion","texto","personas","sonido"}},
  "mes1"/"mes2"/"mes3": {"titulo","objetivo",
             "filas":[{"eje","idea","que"}]*6 (fila 4 es la de "viral"),"nota"},
  "slide11": {"propiedades":[{"titulo","desc"}]*6,"promociones"},
  "slide12": {"contenido":[str]*4,"negocio":[str]*4,"marca":[str]*4,"revision"},
  "slide13": {"preguntas":[str]*12},
  "slide14": {"frase_cierre"}
}

Reglas para quien arma `data` (el agente GPT):
- NUNCA inventar los colores de marca: si el usuario no los paso, pedirlos
  (HEX o Pantone) ANTES de llamar a generar_pdf.
- Si falta contenido de algun campo, completar con una hipotesis razonable
  marcada como tal (ej. "(a validar con el cliente)"), nunca dejarlo vacio:
  eso rompe el diseño.
- Los campos de texto no necesitan punto final salvo que se indique lo
  contrario: la funcion no agrega puntuacion sola (a diferencia de la
  plantilla HTML hermana de este script).
"""

from reportlab.lib.colors import HexColor
from reportlab.pdfgen import canvas
from reportlab.pdfbase.pdfmetrics import stringWidth

PAGE_W, PAGE_H = 1280, 720
FONT_DISPLAY = "Times-Bold"
FONT_DISPLAY_IT = "Times-Italic"
FONT_BODY = "Helvetica"
FONT_BODY_B = "Helvetica-Bold"


def _pal(colores):
    d = {
        "bg": "#F5F1D6", "primary": "#173E4E", "accent": "#C8E27D",
        "card_a": "#FFFCEB", "card_b": "#E8F0E8", "on_primary": "#F5F1D6",
        "border": "#E4DCC0", "highlight": "#B76845",
    }
    d.update(colores or {})
    return {k: HexColor(v) for k, v in d.items()}


def _rr(c, x, y_top, w, h, r=14, fill=None, stroke=None, lw=1):
    y = PAGE_H - y_top - h
    c.saveState()
    if fill is not None:
        c.setFillColor(fill)
    if stroke is not None:
        c.setStrokeColor(stroke)
        c.setLineWidth(lw)
    c.roundRect(x, y, w, h, r, fill=1 if fill is not None else 0,
                stroke=1 if stroke is not None else 0)
    c.restoreState()


def _wrap(text, font, size, max_w):
    words = str(text).split()
    lines, cur = [], ""
    for w in words:
        test = (cur + " " + w).strip()
        if stringWidth(test, font, size) <= max_w:
            cur = test
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines or [""]


def _text_block(c, text, x, y_top, max_w, font, size, color, leading=None, align="left"):
    leading = leading or size * 1.35
    c.setFont(font, size)
    c.setFillColor(color)
    lines = _wrap(text, font, size, max_w)
    y = PAGE_H - y_top - size
    for line in lines:
        if align == "center":
            c.drawCentredString(x + max_w / 2, y, line)
        else:
            c.drawString(x, y, line)
        y -= leading
    return y_top + (len(lines) * leading)


def _eyebrow(c, text, x, y_top, color, size=10):
    c.setFont(FONT_BODY_B, size)
    c.setFillColor(color)
    c.drawString(x, PAGE_H - y_top - size, text.upper())


def _footer(c, pal, marca, anio, page_num):
    c.setFont(FONT_BODY, 10)
    c.setFillColor(pal["primary"])
    c.drawString(56, 24, f"{marca} / PROPUESTA {anio}")
    c.drawRightString(PAGE_W - 56, 24, f"BIO MARKETING   {page_num}")


def _topbar(c, pal):
    c.setFillColor(pal["primary"])
    c.rect(0, PAGE_H - 8, PAGE_W, 8, fill=1, stroke=0)


def _page_header(c, pal, idx, titulo, subtitulo, marca, anio, page_num):
    c.setFillColor(pal["bg"])
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    _topbar(c, pal)
    _eyebrow(c, idx, 56, 44, pal["primary"])
    c.setFont(FONT_DISPLAY, 32)
    c.setFillColor(pal["primary"])
    c.drawString(56, PAGE_H - 44 - 46, titulo)
    _text_block(c, subtitulo, 56, 100, PAGE_W - 112, FONT_BODY, 13, pal["primary"])
    _footer(c, pal, marca, anio, page_num)


# ---------------------------------------------------------------- SLIDE 1
def _slide_portada(c, d, pal):
    c.setFillColor(pal["primary"])
    c.rect(0, 0, PAGE_W / 2, PAGE_H, fill=1, stroke=0)
    c.setFillColor(pal["bg"])
    c.rect(PAGE_W / 2, 0, PAGE_W / 2, PAGE_H, fill=1, stroke=0)

    x = 60
    y = 190
    c.setFont(FONT_DISPLAY, 42)
    c.setFillColor(pal["on_primary"])
    c.drawString(x, PAGE_H - y, d["marca"])
    c.drawString(x, PAGE_H - y - 50, d.get("linea", ""))

    _text_block(c, "PROPUESTA DE POSICIONAMIENTO + ESTRATEGIA DE CONTENIDO", x, 320, 520,
                FONT_BODY_B, 13, pal["accent"], leading=17)
    c.setFont(FONT_DISPLAY_IT, 18)
    c.setFillColor(pal["on_primary"])
    c.drawString(x, PAGE_H - 390, ". ".join(d["palabras_clave"]) + ".")

    _text_block(c, f"Propuesta inicial para presentar, validar y ajustar con el equipo de {d['marca']}.",
                x, 420, 420, FONT_BODY, 12, pal["on_primary"], leading=16)

    px = x
    for label in [d["portada"]["pill_a"], d["portada"]["pill_b"], d["portada"]["pill_c"]]:
        w = stringWidth(label, FONT_BODY_B, 10) + 28
        _rr(c, px, 470, w, 32, r=16, fill=pal["accent"])
        c.setFont(FONT_BODY_B, 10)
        c.setFillColor(pal["primary"])
        c.drawCentredString(px + w / 2, PAGE_H - 470 - 21, label)
        px += w + 10

    c.setFont(FONT_BODY, 11)
    c.setFillColor(pal["on_primary"])
    c.drawString(x, PAGE_H - 540, d["fecha"])

    rx, rw = PAGE_W / 2 + 40, PAGE_W / 2 - 100
    _rr(c, rx, 60, rw, 300, r=18, fill=pal["card_a"], stroke=pal["border"])
    c.setFont(FONT_BODY_B, 10)
    c.setFillColor(pal["primary"])
    c.drawCentredString(rx + rw / 2, PAGE_H - 60 - 90, "DURACIÓN DE LA PROPUESTA")
    c.setFont(FONT_DISPLAY, 64)
    c.drawCentredString(rx + rw / 2, PAGE_H - 60 - 170, d["portada"]["duracion_meses"])
    c.setFont(FONT_BODY_B, 10)
    c.drawCentredString(rx + rw / 2, PAGE_H - 60 - 210, "MESES")

    _rr(c, rx, 380, rw, 260, r=18, fill=pal["primary"])
    c.setFont(FONT_DISPLAY, 44)
    c.setFillColor(pal["on_primary"])
    c.drawCentredString(rx + rw / 2, PAGE_H - 380 - 70, "“")
    _text_block(c, d["portada"]["frase_espiritu"], rx + 24, 460, rw - 48,
                FONT_DISPLAY_IT, 15, pal["on_primary"], leading=20, align="center")


# ---------------------------------------------------------------- SLIDE 2
def _slide_norte(c, d, pal, marca, anio):
    s = d["slide2"]
    _page_header(c, pal, "01 / NORTE ESTRATÉGICO", "La marca que queremos construir",
                 s["objetivo"] + ".", marca, anio, 2)
    lx, lw = 56, 560
    _rr(c, lx, 160, lw, 300, r=18, fill=pal["primary"])
    _eyebrow(c, "HIPÓTESIS DE POSICIONAMIENTO", lx + 24, 190, pal["accent"], 10)
    _text_block(c, s["hipotesis"], lx + 24, 225, lw - 48, FONT_DISPLAY, 19, pal["on_primary"], leading=24)
    _text_block(c, s["aclaracion"], lx + 24, 340, lw - 48, FONT_BODY, 12, pal["on_primary"], leading=16)

    rx, rw = 56 + lw + 24, PAGE_W - 56 - (56 + lw + 24)
    _rr(c, rx, 160, rw, 300, r=18, fill=pal["card_a"], stroke=pal["border"])
    _eyebrow(c, "TERRITORIO DE MARCA", rx + 24, 190, pal["primary"], 10)
    ax0, ay0 = rx + 60, 400
    c.setStrokeColor(pal["border"])
    c.setLineWidth(2)
    c.line(ax0, PAGE_H - ay0, ax0, PAGE_H - 240)
    c.line(ax0, PAGE_H - ay0, rx + rw - 40, PAGE_H - ay0)
    c.setFillColor(pal["accent"])
    c.circle(rx + rw - 130, PAGE_H - 300, 16, fill=1, stroke=0)
    c.setFont(FONT_BODY_B, 11)
    c.setFillColor(pal["primary"])
    c.drawString(rx + rw - 105, PAGE_H - 304, d["marca"])
    _text_block(c, f'{s["que_no_es"]} / {s["que_si_es"]}.', rx + 24, 420, rw - 48,
                FONT_BODY, 12, pal["primary"], leading=16, align="center")


# ---------------------------------------------------------------- SLIDE 3
def _slide_persona(c, d, pal, marca, anio):
    s = d["slide3"]
    _page_header(c, pal, "02 / PERSONA Y MOMENTOS", "A quién le hablamos y cuándo",
                 s["intro"] + ".", marca, anio, 3)
    cw, gap = (PAGE_W - 112 - 3 * 16) / 4, 16
    y = 200
    for i, st in enumerate(s["stats"]):
        x = 56 + i * (cw + gap)
        bg = pal["card_a"] if i % 2 == 0 else pal["card_b"]
        _rr(c, x, y, cw, 110, r=16, fill=bg, stroke=pal["border"])
        c.setFont(FONT_DISPLAY, 20)
        c.setFillColor(pal["primary"])
        c.drawCentredString(x + cw / 2, PAGE_H - y - 45, st["titulo"])
        _text_block(c, st["desc"], x + 12, y + 60, cw - 24, FONT_BODY, 10.5,
                    pal["primary"], leading=13, align="center")

    _eyebrow(c, "LOS MOMENTOS QUE DEBEN QUEDAR INSTALADOS", 56, 340, pal["primary"], 10)
    mw = (PAGE_W - 112 - 2 * 20) / 3
    y2 = 370
    for i, m in enumerate(s["momentos"]):
        x = 56 + i * (mw + 20)
        dark = i == 1
        _rr(c, x, y2, mw, 130, r=16,
            fill=pal["primary"] if dark else pal["card_a"],
            stroke=None if dark else pal["border"])
        fg = pal["on_primary"] if dark else pal["primary"]
        _eyebrow(c, f"MOMENTO {i + 1}", x + 20, y2 + 20, pal["accent"] if dark else pal["primary"], 9)
        c.setFont(FONT_BODY_B, 13)
        c.setFillColor(fg)
        c.drawString(x + 20, PAGE_H - y2 - 62, m["que"])
        c.setFont(FONT_DISPLAY_IT, 11)
        c.drawString(x + 20, PAGE_H - y2 - 90, f'"{m["frase"]}."')


# ---------------------------------------------------------------- SLIDE 4 / 5 (grid de 6 tarjetas)
def _grid6(c, pal, items, y0, numbered, title_font=FONT_BODY_B, title_size=13):
    cw, gap = (PAGE_W - 112 - 2 * 20) / 3, 20
    for i, it in enumerate(items):
        col, row = i % 3, i // 3
        x = 56 + col * (cw + gap)
        y = y0 + row * 130
        bg = pal["card_a"] if row == 0 else pal["card_b"]
        _rr(c, x, y, cw, 110, r=14, fill=bg, stroke=pal["border"])
        tx = x + 20
        if numbered:
            _rr(c, tx, y + 16, 26, 26, r=13, fill=pal["accent"])
            c.setFont(FONT_BODY_B, 11)
            c.setFillColor(pal["primary"])
            c.drawCentredString(tx + 13, PAGE_H - y - 16 - 18, str(i + 1))
            tx += 36
        c.setFont(title_font, title_size)
        c.setFillColor(pal["primary"])
        c.drawString(tx, PAGE_H - y - 34, it["titulo"])
        _text_block(c, it["desc"], x + 20, y + 55, cw - 40, FONT_BODY, 10.5, pal["primary"], leading=13)


def _slide_activos(c, d, pal, marca, anio):
    _page_header(c, pal, "03 / ACTIVOS REALES", f"Qué tiene {marca} para construir posicionamiento",
                 "La estrategia se apoya en ventajas que ya existen; no en inventar una personalidad nueva.",
                 marca, anio, 4)
    _grid6(c, pal, d["slide4"]["activos"], 190, numbered=True)


def _slide_pilares(c, d, pal, marca, anio):
    s = d["slide5"]
    _page_header(c, pal, "04 / PILARES", "El sistema de posicionamiento",
                 f'{s["n_pilares"]} pilares. {s["reparto"]}.', marca, anio, 5)
    _grid6(c, pal, s["pilares"], 190, numbered=False, title_font=FONT_DISPLAY, title_size=16)
    _rr(c, 56, 460, PAGE_W - 112, 50, r=14, fill=pal["primary"])
    c.setFont(FONT_BODY_B, 12)
    c.setFillColor(pal["on_primary"])
    c.drawCentredString(PAGE_W / 2, PAGE_H - 460 - 31, f'REGLA DE MARCA: {s["regla"]}.')


# ---------------------------------------------------------------- SLIDE 6
def _slide_sistema(c, d, pal, marca, anio):
    s = d["slide6"]
    _page_header(c, pal, "05 / CONTENIDO", f'Sistema mensual: {s["n_piezas"]} piezas',
                 s["intro"] + ".", marca, anio, 6)
    lx, lw = 56, 560
    _rr(c, lx, 190, lw, 300, r=18, fill=pal["primary"])
    c.setFont(FONT_DISPLAY, 20)
    c.setFillColor(pal["on_primary"])
    c.drawString(lx + 24, PAGE_H - 190 - 40, f'{s["n_reels"]} REELS / MES')
    yy = 260
    for i, r in enumerate(s["reels"]):
        _rr(c, lx + 24, yy, 26, 26, r=13, fill=pal["accent"])
        c.setFont(FONT_BODY_B, 11)
        c.setFillColor(pal["primary"])
        c.drawCentredString(lx + 24 + 13, PAGE_H - yy - 18, str(i + 1))
        c.setFont(FONT_BODY_B, 12)
        c.setFillColor(pal["on_primary"])
        c.drawString(lx + 60, PAGE_H - yy - 12, r["pilar"])
        if "que" in r:
            c.setFont(FONT_BODY, 10.5)
            c.drawString(lx + 60, PAGE_H - yy - 27, r["que"])
        yy += 46

    rx, rw = lx + lw + 24, PAGE_W - 56 - (lx + lw + 24)
    _rr(c, rx, 190, rw, 300, r=18, fill=pal["card_a"], stroke=pal["border"])
    c.setFont(FONT_DISPLAY, 20)
    c.setFillColor(pal["primary"])
    c.drawString(rx + 24, PAGE_H - 190 - 40, f'{s["n_placas"]} PLACAS / MES')
    yy = 260
    for i, p in enumerate(s["placas"]):
        c.setFont(FONT_BODY_B, 11)
        c.setFillColor(pal["primary"])
        c.drawString(rx + 24, PAGE_H - yy - 10, f"PLACA {i + 1}")
        _text_block(c, p["desc"] + ".", rx + 24, yy + 14, rw - 48, FONT_BODY, 10.5, pal["primary"], leading=13)
        yy += 60
    px = rx + 24
    for label in [s["tag_a"], s["tag_b"], s["tag_c"]]:
        w = stringWidth(label, FONT_BODY_B, 9) + 22
        _rr(c, px, 440, w, 26, r=13, fill=pal["accent"])
        c.setFont(FONT_BODY_B, 9)
        c.setFillColor(pal["primary"])
        c.drawCentredString(px + w / 2, PAGE_H - 440 - 17, label)
        px += w + 8


# ---------------------------------------------------------------- SLIDE 7
def _slide_produccion(c, d, pal, marca, anio):
    s = d["slide7"]
    _page_header(c, pal, "06 / PRODUCCIÓN", f"Cómo debe verse {marca}",
                 "Una producción por período debe alimentar todo el ciclo de contenido.", marca, anio, 7)
    lx, lw = 56, 560
    _rr(c, lx, 190, lw, 300, r=18, fill=pal["primary"])
    _eyebrow(c, "UNA PRODUCCIÓN, TODO EL CICLO", lx + 24, 220, pal["accent"], 10)
    _text_block(c, "Reels, historias, placas y publicidad salen del mismo banco de contenido.",
                lx + 40, 280, lw - 80, FONT_DISPLAY, 18, pal["on_primary"], leading=24, align="center")

    rx, rw = lx + lw + 24, PAGE_W - 56 - (lx + lw + 24)
    _rr(c, rx, 190, rw, 300, r=18, fill=pal["card_a"], stroke=pal["border"])
    _eyebrow(c, "CHECKLIST DE PRODUCCIÓN", rx + 24, 215, pal["primary"], 10)
    yy = 245
    for item in s["checklist"] + ["Grabar todo sin texto para reutilizar en reels, historias y placas."]:
        c.setFillColor(pal["primary"])
        c.circle(rx + 28, PAGE_H - yy - 6, 2, fill=1, stroke=0)
        yy_after = _text_block(c, item, rx + 38, yy, rw - 70, FONT_BODY, 10.5, pal["primary"], leading=13)
        yy = yy_after + 6
    l = s["lenguaje"]
    _text_block(c, f'LENGUAJE  {l["duracion"]} / {l["texto"]} / {l["personas"]} / {l["sonido"]}.',
                rx + 24, 440, rw - 48, FONT_BODY, 10.5, pal["primary"], leading=14)


# ---------------------------------------------------------------- SLIDES 8-10 (mes 1/2/3)
def _slide_mes(c, d, pal, marca, anio, key, idx_num, page_num):
    s = d[key]
    _page_header(c, pal, f"{idx_num} / {key.upper().replace('MES', 'MES ')}", s["titulo"],
                 f'Objetivo: {s["objetivo"]}.', marca, anio, page_num)
    y = 190
    colx = [56, 150, 280, 640]
    c.setFont(FONT_BODY_B, 9)
    c.setFillColor(HexColor("#8A8A80"))
    for label, x in zip(["PIEZA", "EJE", "IDEA", "QUÉ MOSTRAMOS"], colx):
        c.drawString(x, PAGE_H - y, label)
    y += 26
    for i, fila in enumerate(s["filas"]):
        tipo = "REEL" if i < 4 else "PLACA"
        tagw, tagh = 70, 34
        _rr(c, colx[0], y, tagw, tagh, r=12,
            fill=pal["primary"] if tipo == "REEL" else pal["card_b"])
        c.setFont(FONT_BODY_B, 9)
        c.setFillColor(pal["on_primary"] if tipo == "REEL" else pal["primary"])
        c.drawCentredString(colx[0] + tagw / 2, PAGE_H - y - tagh / 2 - 3, tipo)

        eje_color = pal["highlight"] if i == 3 else pal["primary"]
        c.setFont(FONT_BODY_B, 9.5)
        c.setFillColor(eje_color)
        c.drawString(colx[1], PAGE_H - y - 20, fila["eje"].upper())

        c.setFont(FONT_BODY_B, 11)
        c.setFillColor(pal["primary"])
        for line in _wrap(fila["idea"], FONT_BODY_B, 11, colx[3] - colx[2] - 16):
            c.drawString(colx[2], PAGE_H - y - 15, line)
            break
        _text_block(c, fila["que"], colx[3], y + 4, PAGE_W - 56 - colx[3], FONT_BODY, 10, pal["primary"], leading=13)
        y += 70
    _text_block(c, s["nota"] + ".", 56, y + 10, PAGE_W - 112, FONT_DISPLAY_IT, 11, pal["primary"], leading=14)


# ---------------------------------------------------------------- SLIDE 11
def _slide_propiedades(c, d, pal, marca, anio):
    _page_header(c, pal, "10 / PROPIEDADES Y ACCIONES", f"Que {marca} tenga cosas propias",
                 'No todo debe ser "contenido". Algunas acciones tienen que pasar en la vida real y '
                 "luego convertirse en comunicación.", marca, anio, 11)
    _grid6(c, pal, d["slide11"]["propiedades"], 190, numbered=False, title_font=FONT_DISPLAY, title_size=15)
    c.setFont(FONT_BODY_B, 11)
    c.setFillColor(pal["highlight"])
    c.drawCentredString(PAGE_W / 2, PAGE_H - 480, f'PROMOCIONES: {d["slide11"]["promociones"]}.')


# ---------------------------------------------------------------- SLIDE 12
def _slide_medicion(c, d, pal, marca, anio):
    s = d["slide12"]
    _page_header(c, pal, "11 / MEDICIÓN", "Qué vamos a mirar",
                 'El objetivo no es "subir contenido". Es entender qué construye deseo, visitas y recurrencia.',
                 marca, anio, 12)
    cols = [("CONTENIDO", s["contenido"], False), ("NEGOCIO", s["negocio"], True), ("MARCA", s["marca"], False)]
    cw, gap = (PAGE_W - 112 - 2 * 20) / 3, 20
    card_h = 280
    for i, (title, items, dark) in enumerate(cols):
        x = 56 + i * (cw + gap)
        _rr(c, x, 190, cw, card_h, r=16, fill=pal["primary"] if dark else pal["card_a"],
            stroke=None if dark else pal["border"])
        c.setFont(FONT_DISPLAY, 16)
        c.setFillColor(pal["accent"] if dark else pal["primary"])
        c.drawCentredString(x + cw / 2, PAGE_H - 190 - 36, title)
        yy = 80
        for it in items:
            dotc = pal["accent"] if dark else pal["primary"]
            c.setFillColor(dotc)
            c.circle(x + 24, PAGE_H - 190 - yy + 4, 3, fill=1, stroke=0)
            c.setFont(FONT_BODY, 10.5)
            c.setFillColor(pal["on_primary"] if dark else pal["primary"])
            c.drawString(x + 36, PAGE_H - 190 - yy, it)
            yy += 42
    y_after = 190 + card_h + 30
    _eyebrow(c, "A LOS 30 / 60 / 90 DÍAS", 56, y_after, pal["primary"], 10)
    _text_block(c, s["revision"] + ".", 56, y_after + 24, PAGE_W - 112, FONT_BODY, 11.5, pal["primary"], leading=15)


# ---------------------------------------------------------------- SLIDE 13
def _slide_validacion(c, d, pal, marca, anio):
    _page_header(c, pal, "12 / VALIDACIÓN", "Preguntas para la reunión",
                 "Esta propuesta es V1. La reunión se graba, se transcribe y se usa para construir la "
                 "versión final ejecutable.", marca, anio, 13)
    preguntas = d["slide13"]["preguntas"]
    colw = (PAGE_W - 112 - 40) / 2
    for i, q in enumerate(preguntas):
        col = i // 6
        row = i % 6
        x = 56 + col * (colw + 40)
        y = 200 + row * 44
        dark = col == 0
        _rr(c, x, y, 22, 22, r=11, fill=pal["primary"] if dark else pal["accent"])
        c.setFont(FONT_BODY_B, 10)
        c.setFillColor(pal["on_primary"] if dark else pal["primary"])
        c.drawCentredString(x + 11, PAGE_H - y - 15, str(i + 1))
        _text_block(c, q, x + 34, y + 2, colw - 34, FONT_BODY, 10.5, pal["primary"], leading=13)
    _rr(c, 56, 480, PAGE_W - 112, 44, r=14, fill=pal["primary"])
    c.setFont(FONT_BODY_B, 11)
    c.setFillColor(pal["on_primary"])
    c.drawCentredString(PAGE_W / 2, PAGE_H - 480 - 28,
                         "POST REUNIÓN: PROPUESTA V1  ->  TRANSCRIPCIÓN  ->  CORRECCIONES  ->  ESTRATEGIA V2 EJECUTABLE")


# ---------------------------------------------------------------- SLIDE 14
def _slide_cierre(c, d, pal, marca):
    c.setFillColor(pal["primary"])
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    c.setFont(FONT_BODY_B, 11)
    c.setFillColor(pal["accent"])
    c.drawCentredString(PAGE_W / 2, PAGE_H - 300, "PROPUESTA PARA VALIDAR")
    c.setFont(FONT_DISPLAY, 34)
    c.setFillColor(pal["on_primary"])
    y = 350
    for palabra in d["palabras_clave"]:
        c.drawCentredString(PAGE_W / 2, PAGE_H - y, f"{palabra}.")
        y += 42
    _text_block(c, d["slide14"]["frase_cierre"] + ".", PAGE_W / 2 - 280, y + 20, 560,
                FONT_BODY, 12, pal["on_primary"], leading=16, align="center")
    c.setFont(FONT_BODY_B, 12)
    c.drawCentredString(PAGE_W / 2, PAGE_H - y - 70, f"{marca} × BIO MARKETING")


def generar_pdf(data, output_path):
    """Arma el PDF de 14 paginas a partir del diccionario `data`. Ver el
    docstring del modulo para el esquema completo, y EJEMPLO para un caso
    resuelto que se puede copiar y adaptar."""
    pal = _pal(data.get("colores", {}))
    marca, anio = data["marca"], data["anio"]
    c = canvas.Canvas(output_path, pagesize=(PAGE_W, PAGE_H))

    _slide_portada(c, data, pal); c.showPage()
    _slide_norte(c, data, pal, marca, anio); c.showPage()
    _slide_persona(c, data, pal, marca, anio); c.showPage()
    _slide_activos(c, data, pal, marca, anio); c.showPage()
    _slide_pilares(c, data, pal, marca, anio); c.showPage()
    _slide_sistema(c, data, pal, marca, anio); c.showPage()
    _slide_produccion(c, data, pal, marca, anio); c.showPage()
    _slide_mes(c, data, pal, marca, anio, "mes1", "07", 8); c.showPage()
    _slide_mes(c, data, pal, marca, anio, "mes2", "08", 9); c.showPage()
    _slide_mes(c, data, pal, marca, anio, "mes3", "09", 10); c.showPage()
    _slide_propiedades(c, data, pal, marca, anio); c.showPage()
    _slide_medicion(c, data, pal, marca, anio); c.showPage()
    _slide_validacion(c, data, pal, marca, anio); c.showPage()
    _slide_cierre(c, data, pal, marca); c.showPage()

    c.save()
    return output_path


EJEMPLO = {
    "marca": "NORA", "linea": "INDUMENTARIA", "fecha": "12.09.2026", "anio": "2026",
    "palabras_clave": ["Atemporal", "Femenino", "Artesanal"],
    "colores": {
        "bg": "#F6EFE7", "primary": "#5C2A2A", "accent": "#E3A857",
        "card_a": "#FDF7F0", "card_b": "#EFE2D6", "on_primary": "#F6EFE7",
        "border": "#E6D8C6", "highlight": "#B76845",
    },
    "portada": {
        "pill_a": "COLECCIÓN 60%", "pill_b": "TALLER 30%", "pill_c": "COMUNIDAD",
        "duracion_meses": "3",
        "frase_espiritu": "Ropa que se hace a mano y se usa toda la vida.",
    },
    "slide2": {
        "objetivo": "NORA no necesita ser la marca mas grande. Necesita ser la mas deseada de su nicho",
        "hipotesis": "Prendas atemporales, hechas a mano, para quien elige calidad por sobre cantidad.",
        "aclaracion": "La sofisticacion esta en el material y la confeccion, no en el precio inaccesible.",
        "que_no_es": "No lujo. No fast fashion", "que_si_es": "Si diseño, calidad y cercania con la clienta",
    },
    "slide3": {
        "intro": "NORA vive del lanzamiento de coleccion al uso diario de la prenda",
        "stats": [
            {"titulo": "+28", "desc": "Mujeres que valoran diseño y calidad por sobre precio."},
            {"titulo": "REPETIDORAS", "desc": "Clientas que ya compraron y vuelven por mas."},
            {"titulo": "REGALO", "desc": "Buscan una prenda distinta para regalar."},
            {"titulo": "VALOR", "desc": "Una prenda que dura y se nota que es artesanal."},
        ],
        "momentos": [
            {"que": "Lanzamiento de coleccion", "frase": "Quiero verla antes que se agote"},
            {"que": "Compra por evento puntual", "frase": "Necesito algo distinto para esa ocasion"},
            {"que": "Uso diario de la prenda", "frase": "Es mi prenda de todos los dias"},
        ],
    },
    "slide4": {"activos": [
        {"titulo": "TALLER PROPIO", "desc": "Confeccion artesanal verificable, no tercerizada"},
        {"titulo": "MATERIALES NOBLES", "desc": "Telas e insumos elegidos por durabilidad y caida"},
        {"titulo": "PRECIO / CALIDAD", "desc": "Propuesta premium con ticket todavia accesible"},
        {"titulo": "COMUNIDAD ARMADA", "desc": "Base de clientas repetidoras ya construida"},
        {"titulo": "DISEÑO PROPIO", "desc": "Patrones y modelos que no se consiguen en otro lado"},
        {"titulo": "PRODUCCION CHICA", "desc": "Series limitadas que generan urgencia real"},
    ]},
    "slide5": {
        "n_pilares": "6", "reparto": "Coleccion 60% / Taller 30% / Comunidad transversal",
        "pilares": [
            {"titulo": "COLECCIÓN", "desc": "Lanzamientos, lookbook, nuevas prendas"},
            {"titulo": "TALLER", "desc": "Proceso de confeccion, materiales, detalle"},
            {"titulo": "CLIENTA REAL", "desc": "Como se usa la prenda en el dia a dia"},
            {"titulo": "COMUNIDAD", "desc": "Clientas repetidoras, testimonios, alianzas"},
            {"titulo": "ESTÉTICA", "desc": "Fotografia, paleta, styling, moodboard"},
            {"titulo": "EDICIÓN LIMITADA", "desc": "Series cortas, urgencia, numeracion"},
        ],
        "regla": "Viral si, pero nunca a costa de verse masiva o descartable",
    },
    "slide6": {
        "n_piezas": "6", "intro": "Contenido corto, fotografico, con foco en textura y detalle de confeccion",
        "n_reels": "4",
        "reels": [
            {"pilar": "TALLER", "que": "Proceso de confeccion de una prenda puntual."},
            {"pilar": "COLECCIÓN", "que": "Presentacion de una prenda nueva."},
            {"pilar": "CLIENTA REAL", "que": "Una clienta usando la prenda en su rutina."},
            {"pilar": "COLECCIÓN / VIRAL"},
        ],
        "n_placas": "2",
        "placas": [
            {"desc": "Foto de detalle de tela/costura + copy minimo sobre el material"},
            {"desc": "Lookbook de una prenda en dos contextos de uso distintos"},
        ],
        "tag_a": "COLECCIÓN", "tag_b": "TALLER", "tag_c": "COMUNIDAD",
    },
    "slide7": {
        "checklist": [
            "3 prendas fotografiadas: detalle, cuerpo completo y contexto de uso.",
            "1 secuencia del proceso de confeccion en el taller.",
            "2 situaciones con clienta real usando la prenda.",
            "Detalles de textura, costura y materiales sin texto encima.",
        ],
        "lenguaje": {"duracion": "8-15 s", "texto": "minimo", "personas": "clientas reales",
                     "sonido": "musica suave, sin hablar a camara"},
    },
    "mes1": {
        "titulo": "Instalar el territorio",
        "objetivo": "que cualquiera que vea NORA entienda rapido que ofrece, como se siente y por que vale la pena",
        "filas": [
            {"eje": "TALLER", "idea": "El taller NORA", "que": "Manos cosiendo, tela, maquina y primer plano del detalle terminado."},
            {"eje": "COLECCIÓN", "idea": "Prenda nueva, hecha en el momento", "que": "Corte, costura y prenda terminada en el maniqui."},
            {"eje": "TALLER", "idea": "NORA de cerca", "que": "Textura de tela, costura y detalle que no se ve en la foto de catalogo."},
            {"eje": "COLECCIÓN / VIRAL", "idea": "Tendencia del mes", "que": "A completar por BioMarketing con una referencia actual adaptable a NORA."},
            {"eje": "TALLER", "idea": "Detras de una prenda", "que": "Foto lifestyle del proceso: tela, manos y maquina. Copy corto."},
            {"eje": "COLECCIÓN", "idea": "NORA de esta semana", "que": "Carrusel de 3-4 prendas recientes."},
        ],
        "nota": "Resultado buscado del mes 1: instalar taller, coleccion y calidad artesanal como tres motivos claros para elegir NORA",
    },
    "mes2": {
        "titulo": "Construir hábito",
        "objetivo": "dejar de mostrar solamente prendas y empezar a instalar momentos de uso repetibles",
        "filas": [
            {"eje": "CLIENTA REAL", "idea": "NORA en el uso diario", "que": "Persona usando la prenda en su rutina, sin dialogo."},
            {"eje": "TALLER", "idea": "De la tela a la prenda", "que": "Una prenda en todo su recorrido: corte, costura y primera prueba."},
            {"eje": "CLIENTA REAL", "idea": "Dos prendas que combinan", "que": "Como se usan juntas en un mismo look, manos reales."},
            {"eje": "COLECCIÓN / VIRAL", "idea": "Tendencia del mes", "que": "A completar por BioMarketing. La prenda debe seguir viendose artesanal."},
            {"eje": "COMUNIDAD", "idea": "Una clienta que vuelve", "que": "Testimonio corto de una clienta repetidora."},
            {"eje": "TALLER", "idea": "No es produccion en serie", "que": 'Detalle de confeccion + "Hecha a mano, una por una".'},
        ],
        "nota": "Meta del mes 2: asociar NORA a una eleccion real: comprar para durar, no para descartar",
    },
    "mes3": {
        "titulo": "Expandir comunidad y recordación",
        "objetivo": "llevar la marca mas alla de la prenda sin perder el tono artesanal y cercano",
        "filas": [
            {"eje": "COMUNIDAD", "idea": "Encuentro con clientas", "que": "Recap de un evento chico o probador abierto en el taller."},
            {"eje": "COLECCIÓN", "idea": "3 prendas / 1 semana", "que": "Montaje rapido de tres prendas distintas para reforzar variedad."},
            {"eje": "CLIENTA REAL", "idea": "NORA en la calle", "que": "Clienta usando la prenda caminando por la ciudad."},
            {"eje": "COLECCIÓN / VIRAL", "idea": "Tendencia del mes", "que": "A completar por BioMarketing con tendencia actual que respete estetica y publico."},
            {"eje": "TALLER", "idea": "Origen de los materiales", "que": "De donde salen las telas e insumos que usa NORA."},
            {"eje": "COLECCIÓN", "idea": "Edicion limitada", "que": "Foto de una serie corta, numeracion y por que es limitada."},
        ],
        "nota": "Mes 3 prepara la siguiente etapa: duplicar lo que mejor funcione segun metricas, no segun intuicion",
    },
    "slide11": {
        "propiedades": [
            {"titulo": "NORA TALLER", "desc": "Codigo transversal para mostrar el proceso de confeccion en vivo"},
            {"titulo": "NORA DE HOY", "desc": "Formato que instala la variedad de la coleccion activa"},
            {"titulo": "NORA CLIENTA", "desc": "Testimonios y uso real de clientas repetidoras"},
            {"titulo": "NORA EDICIÓN", "desc": "Series limitadas numeradas, con fecha de cierre"},
            {"titulo": "NORA STUDIO", "desc": "Alianzas con estudios de diseño o fotografia cercanos"},
            {"titulo": "NORA COLLAB", "desc": "Una alianza local por vez: diseño, arte o produccion textil"},
        ],
        "promociones": "puntuales, medibles y con proposito. Evitar descuentos permanentes que bajen la percepcion de valor",
    },
    "slide12": {
        "contenido": ["Alcance a no seguidores", "Guardados", "Compartidos", "Visitas al perfil"],
        "negocio": ["Ventas de coleccion actual", "Ventas de series limitadas", "Ticket promedio", "Repeticion de compra"],
        "marca": ["Etiquetas / UGC de clientas", "Consultas por prenda puntual", "Participacion en encuentros", "Clientas que vuelven"],
        "revision": "Mantener lo que funciona, duplicar prendas/formatos ganadores, ajustar precios/series y decidir que propiedades continuan",
    },
    "slide13": {"preguntas": [
        "¿Cuales son las prendas mas vendidas hoy?",
        "¿Que prendas quieren empujar por margen o estrategia?",
        "¿Cual es el proceso exacto de confeccion que quieren mostrar?",
        "¿Que porcentaje de ventas es por Instagram y cuanto quieren hacerlo crecer?",
        "¿Las series limitadas se agotan rapido o sobra stock?",
        "¿Que tipo de clienta sienten que hoy representa mejor a NORA?",
        "¿Quieren abrir el taller a visitas o eventos chicos?",
        "¿Que otra marca o rubro sienten afin para una alianza?",
        "¿Hasta donde estan dispuestos a usar descuentos o beneficios?",
        "¿Que material o proveedor es el mas dificil de comunicar bien?",
        "¿Cual es la mejor foto que tienen hoy de una clienta real usando la ropa?",
        'En un año: ¿que quieren que diga alguien cuando escucha "NORA"?',
    ]},
    "slide14": {"frase_cierre": "El contenido no debe hacer ruido por hacer ruido. Tiene que hacer que NORA se vea como una marca a la que volves"},
}

if __name__ == "__main__":
    generar_pdf(EJEMPLO, "estrategia_ejemplo.pdf")
    print("OK -> estrategia_ejemplo.pdf")
