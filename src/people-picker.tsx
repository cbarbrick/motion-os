import { useState } from "react";
import type { Member } from "./model";

export function PeoplePicker({
  label,
  members,
  selected,
  userId,
  onChange,
}: {
  label: string;
  members: Member[];
  selected: string[];
  userId: string;
  onChange: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const matches = members.filter((m) =>
    m.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <details className="people-picker">
      <summary>
        {label}
        <span>
          {selected.length
            ? members
                .filter((m) => selected.includes(m.user_id))
                .map((m) => m.name)
                .join(", ")
            : "Select people"}
        </span>
      </summary>
      <div className="people-picker-body">
        {members.length > 5 && (
          <input
            aria-label={`Search ${label.toLowerCase()}`}
            placeholder="Search people"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        )}
        <div className="task-people-list">
          {matches.map((m) => (
            <label className="task-person" key={m.user_id}>
              <input
                type="checkbox"
                checked={selected.includes(m.user_id)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...selected, m.user_id]
                      : selected.filter((id) => id !== m.user_id),
                  )
                }
              />
              <span>
                {m.name}
                {m.user_id === userId ? " (you)" : ""}
              </span>
            </label>
          ))}
          {!matches.length && <p>No matching people</p>}
        </div>
      </div>
    </details>
  );
}
