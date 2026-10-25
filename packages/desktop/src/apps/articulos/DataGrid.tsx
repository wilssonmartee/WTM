import { useEffect, useRef, useState, type CSSProperties } from "react";

interface Column {
  name: string;
  alias: string;
}

/**
 * Tabla virtualizada y seleccionable para grandes volumenes.
 *
 * Virtualizacion: solo renderiza las filas visibles (mas un margen), asi la
 * GUI va fluida aunque haya 100.000+ registros. Usa altura de fila fija.
 *
 * Seleccion estilo nativo: clic selecciona; Ctrl/Cmd+clic alterna; Shift+clic
 * selecciona rango; flechas mueven; Ctrl+A selecciona todo.
 */
export function DataGrid({
  columns,
  rows,
  sortBy,
  sortDir,
  onSort,
  selected,
  setSelected,
}: {
  columns: Column[];
  rows: Record<string, unknown>[];
  sortBy: string | null;
  sortDir: "asc" | "desc";
  onSort: (col: string) => void;
  selected: Set<number>;
  setSelected: (s: Set<number>) => void;
}) {
  const ROW_H = 30; // alto fijo por fila (px)
  const OVERSCAN = 8; // filas extra arriba/abajo
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(400);
  const lastClickIndex = useRef<number | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const total = rows.length;
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const visibleCount = Math.ceil(viewH / ROW_H) + OVERSCAN * 2;
  const last = Math.min(total, first + visibleCount);
  const slice = rows.slice(first, last);

  function handleRowClick(e: React.MouseEvent, index: number) {
    const next = new Set(selected);
    if (e.shiftKey && lastClickIndex.current !== null) {
      const [a, b] = [lastClickIndex.current, index].sort((x, y) => x - y);
      if (!e.ctrlKey && !e.metaKey) next.clear();
      for (let i = a; i <= b; i++) next.add(i);
    } else if (e.ctrlKey || e.metaKey) {
      if (next.has(index)) next.delete(index);
      else next.add(index);
      lastClickIndex.current = index;
    } else {
      next.clear();
      next.add(index);
      lastClickIndex.current = index;
    }
    setSelected(next);
  }

  function handleKey(e: React.KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelected(new Set(rows.map((_, i) => i)));
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const cur = lastClickIndex.current ?? -1;
      const n = e.key === "ArrowDown" ? cur + 1 : cur - 1;
      if (n < 0 || n >= total) return;
      const next = new Set<number>();
      next.add(n);
      setSelected(next);
      lastClickIndex.current = n;
      // Asegurar que la fila quede visible.
      const el = scrollRef.current;
      if (el) {
        const y = n * ROW_H;
        if (y < el.scrollTop) el.scrollTop = y;
        else if (y + ROW_H > el.scrollTop + el.clientHeight)
          el.scrollTop = y + ROW_H - el.clientHeight;
      }
    }
  }

  const gridTemplate = `repeat(${columns.length}, minmax(120px, 1fr))`;

  return (
    <div className="ui-grid" tabIndex={0} onKeyDown={handleKey}>
      {/* Cabecera */}
      <div
        className="ui-grid__head"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        {columns.map((c) => (
          <div
            key={c.name}
            className="ui-grid__th"
            onClick={() => onSort(c.name)}
            title="Ordenar"
          >
            {c.alias}
            {sortBy === c.name ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
          </div>
        ))}
      </div>

      {/* Cuerpo con scroll virtualizado */}
      <div
        className="ui-grid__body"
        ref={scrollRef}
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
      >
        <div style={{ height: total * ROW_H, position: "relative" }}>
          {slice.map((row, i) => {
            const index = first + i;
            const isSel = selected.has(index);
            const style: CSSProperties = {
              position: "absolute",
              top: index * ROW_H,
              height: ROW_H,
              left: 0,
              right: 0,
              display: "grid",
              gridTemplateColumns: gridTemplate,
            };
            return (
              <div
                key={index}
                className={`ui-grid__row ${isSel ? "ui-grid__row--sel" : ""}`}
                style={style}
                onMouseDown={(e) => handleRowClick(e, index)}
              >
                {columns.map((c) => (
                  <div key={c.name} className="ui-grid__cell" title={fmt(row[c.name])}>
                    {fmt(row[c.name])}
                  </div>
                ))}
              </div>
            );
          })}
          {total === 0 && (
            <div className="ui-grid__empty">Sin resultados.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function fmt(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "Si" : "No";
  if (typeof v === "number") return v.toLocaleString();
  return String(v);
}
