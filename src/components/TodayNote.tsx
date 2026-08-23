import { useEffect, useState } from "react";

type Note = { date: string; lines: string[] };

// public/data/notes.txt を読む。書式は、
//   1行目 = 日付、2行目以降 = 本文（1行1項目）、エントリの区切りは --- だけの行。
// 毎日書くものなので、JSONではなくこの形にしている（カンマや引用符でミスしない）。
function parse(text: string): Note[] {
  return text
    .split(/^\s*---\s*$/m)
    .map((block) => block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))
    .filter((lines) => lines.length >= 2)
    .map(([date, ...lines]) => ({ date, lines }));
}

export default function TodayNote({ base }: { base: string }) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [openPast, setOpenPast] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`${base}data/notes.txt`)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error("no notes"))))
      .then((text) => alive && setNotes(parse(text)))
      .catch(() => alive && setNotes([]));
    return () => {
      alive = false;
    };
  }, [base]);

  if (!notes || notes.length === 0) return null;

  const [today, ...past] = notes;

  return (
    <section className="note-section">
      <div className="note-head">
        <h2 className="section-title">編集後記</h2>
        <span className="note-date">{today.date}</span>
      </div>

      <ol className="note-lines">
        {today.lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ol>

      {past.length > 0 && (
        <>
          <button type="button" className="note-more" onClick={() => setOpenPast((v) => !v)}>
            {openPast ? "過去の記録を閉じる" : `過去の記録を見る（${past.length}件）`}
          </button>

          {openPast && (
            <div className="note-past">
              {past.map((note) => (
                <article key={note.date}>
                  <h3>{note.date}</h3>
                  <ol>
                    {note.lines.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ol>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
