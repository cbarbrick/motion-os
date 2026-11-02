export type Kind = "task" | "event" | "idea" | "todo";
export type Role = "admin" | "lead" | "member";
export type View =
  | "home"
  | "week"
  | "team_week"
  | "sponsorships"
  | "affiliates"
  | "people"
  | "tasks"
  | "events"
  | "content"
  | "ideas"
  | "todos"
  | "team";
export interface Member {
  workspace_id: string;
  user_id: string;
  name: string;
  role: Role;
}
export interface Item {
  id: string;
  workspace_id: string;
  kind: Kind;
  title: string;
  description: string;
  status: string;
  priority: "normal" | "high" | "urgent";
  category: string;
  assignee_id: string | null;
  collaborator_ids: string[];
  event_id: string | null;
  athlete_id: string | null;
  event_type: "event" | "fight";
  content_needs: string;
  due_date: string | null;
  week_of: string | null;
  starts_at: string | null;
  ends_at: string | null;
  all_day: boolean;
  event_guest_ids: string[];
  location: string;
  definition_done: string;
  delivery_url: string;
  delivery_notes: string;
  created_by: string;
  version: number;
  created_at: string;
  updated_at: string;
}
export type ItemInput = Pick<
  Item,
  | "title"
  | "description"
  | "status"
  | "priority"
  | "category"
  | "assignee_id"
  | "collaborator_ids"
  | "event_id"
  | "athlete_id"
  | "event_type"
  | "content_needs"
  | "due_date"
  | "week_of"
  | "starts_at"
  | "ends_at"
  | "all_day"
  | "event_guest_ids"
  | "location"
  | "definition_done"
  | "delivery_url"
  | "delivery_notes"
>;
export interface Workspace {
  id: string;
  name: string;
  owner_id: string;
}
export interface Activity {
  id: string;
  actor_id: string;
  title: string;
  created_at: string;
}
export interface TaskNotification {
  id: string;
  workspace_id: string;
  recipient_id: string;
  actor_id: string | null;
  actor_name: string;
  item_id: string;
  item_version: number;
  task_title: string;
  kind: "task_added";
  created_at: string;
  read_at: string | null;
}
export function taskPeople(
  item: Pick<Item, "assignee_id" | "collaborator_ids">,
): string[] {
  return [
    ...new Set(
      [item.assignee_id, ...(item.collaborator_ids || [])].filter(
        (id): id is string => !!id,
      ),
    ),
  ];
}
export function isOnTask(item: Item, userId: string): boolean {
  return item.kind === "task" && taskPeople(item).includes(userId);
}
export type ReviewStatus = "pending" | "approved" | "denied";
export type SponsorshipStatus = ReviewStatus | "active";
export interface SponsorshipInput {
  record_type: "athlete" | "affiliate" | "person";
  rate: string;
  athlete_name: string;
  sport: string;
  profile_url: string;
  contact: string;
  audience: string;
  proposal: string;
  requested_support: string;
  deliverables: string;
  timing: string;
}
export interface Sponsorship extends SponsorshipInput {
  id: string;
  workspace_id: string;
  status: SponsorshipStatus;
  decided_by: string | null;
  decided_at: string | null;
  created_by: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}
export interface SponsorshipComment {
  id: string;
  workspace_id: string;
  sponsorship_id: string;
  author_id: string | null;
  author_name: string;
  body: string;
  action: "comment" | "approved" | "denied" | "pending" | "updated";
  created_at: string;
}
export const sponsorshipLabels: Record<SponsorshipStatus, string> = {
  active: "Active",
  pending: "Pending review",
  approved: "Approved",
  denied: "Denied",
};
export function blankSponsorship(
  record_type: "athlete" | "affiliate" | "person" = "athlete",
): SponsorshipInput {
  return {
    record_type,
    rate: "",
    athlete_name: "",
    sport: "",
    profile_url: "",
    contact: "",
    audience: "",
    proposal: "",
    requested_support: "",
    deliverables: "",
    timing: "",
  };
}
export function sponsorshipInputOf(s: Sponsorship): SponsorshipInput {
  return Object.fromEntries(
    Object.keys(blankSponsorship()).map((k) => [
      k,
      s[k as keyof SponsorshipInput] ??
        blankSponsorship()[k as keyof SponsorshipInput],
    ]),
  ) as unknown as SponsorshipInput;
}
export function isInWeek(item: Item, week: string): boolean {
  return (
    item.kind === "task" &&
    (item.week_of === week ||
      (!item.week_of &&
        !!item.due_date &&
        item.due_date >= week &&
        item.due_date < addDays(week, 7)))
  );
}
export interface Snapshot {
  workspace: Workspace;
  members: Member[];
  items: Item[];
  activity: Activity[];
  grants: { email: string; role: Role }[];
  sponsorships: Sponsorship[];
  sponsorshipComments: SponsorshipComment[];
  sponsorshipReviewer: string | null;
  notifications: TaskNotification[];
}
export const labels: Record<View, string> = {
  home: "Home",
  week: "My week",
  team_week: "Team week",
  sponsorships: "Athletes",
  affiliates: "Affiliates",
  people: "People",
  tasks: "Tasks",
  events: "Calendar",
  content: "Content",
  ideas: "Ideas",
  todos: "My to-dos",
  team: "Team & access",
};
export const statuses: Record<Kind, string[]> = {
  task: ["open", "doing", "done"],
  event: ["planned", "complete"],
  idea: ["inbox", "planned", "archived"],
  todo: ["open", "done"],
};
export const statusLabel: Record<string, string> = {
  open: "Open",
  doing: "In progress",
  done: "Done",
  planned: "Planned",
  complete: "Complete",
  inbox: "Inbox",
  archived: "Archived",
};
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function weekStart(d = new Date()) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7));
  return localDate(copy);
}
export function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + n);
  return localDate(d);
}
export function dateLabel(
  value: string | null,
  opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
) {
  if (!value) return "No date";
  return new Date(
    value.length === 10 ? `${value}T12:00:00` : value,
  ).toLocaleDateString("en-US", opts);
}
export function blankInput(kind: Kind): ItemInput {
  return {
    title: "",
    description: "",
    status: statuses[kind][0],
    priority: "normal",
    category: "Operations",
    assignee_id: null,
    collaborator_ids: [],
    event_id: null,
    athlete_id: null,
    event_type: "event",
    content_needs: "",
    due_date: null,
    week_of: null,
    starts_at: kind === "event" ? new Date().toISOString() : null,
    ends_at: null,
    all_day: false,
    event_guest_ids: [],
    location: "",
    definition_done: "",
    delivery_url: "",
    delivery_notes: "",
  };
}
export function inputOf(item: Item): ItemInput {
  const blank = blankInput(item.kind);
  return Object.fromEntries(
    Object.keys(blank).map((k) => [
      k,
      item[k as keyof Item] ?? blank[k as keyof ItemInput],
    ]),
  ) as ItemInput;
}
export function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
}
export const demoUser = "00000000-0000-4000-8000-000000000001";
export function makeDemo(): Snapshot {
  const w = "00000000-0000-4000-8000-000000000010",
    week = weekStart(),
    now = new Date().toISOString();
  const members = [
    { workspace_id: w, user_id: demoUser, name: "You", role: "admin" as Role },
    {
      workspace_id: w,
      user_id: "00000000-0000-4000-8000-000000000002",
      name: "Alex Rivera",
      role: "lead" as Role,
    },
    {
      workspace_id: w,
      user_id: "00000000-0000-4000-8000-000000000003",
      name: "Jordan Lee",
      role: "member" as Role,
    },
  ];
  const create = (
    n: number,
    kind: Kind,
    title: string,
    data: Partial<ItemInput> = {},
  ): Item => ({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    workspace_id: w,
    kind,
    created_by: demoUser,
    version: 1,
    created_at: now,
    updated_at: now,
    ...blankInput(kind),
    title,
    ...data,
  });
  const event = create(100, "event", "Motion community pop-up", {
    starts_at: new Date(`${addDays(localDate(), 5)}T12:00:00`).toISOString(),
    location: "Venue to be confirmed",
    description:
      "Sample event: introduce Motion to the community. Plan the setup, team coverage and content capture.",
    assignee_id: members[1].user_id,
  });
  return {
    workspace: { id: w, name: "Motion", owner_id: demoUser },
    members,
    sponsorshipReviewer: demoUser,
    sponsorshipComments: [],
    sponsorships: [
      ...[
        [
          "sample-person-1",
          "Jamie Chen",
          "Videographer",
          "$750 / day",
          "Event video and short-form editing.",
        ],
        [
          "sample-person-2",
          "Morgan Reed",
          "Photographer",
          "$125 / hour",
          "Sports, product and event photography.",
        ],
      ].map(([id, name, role, rate, description]): Sponsorship => ({
        ...blankSponsorship("person"),
        id,
        workspace_id: w,
        athlete_name: name,
        sport: role,
        rate,
        proposal: description,
        status: "pending",
        decided_by: null,
        decided_at: null,
        created_by: demoUser,
        version: 1,
        created_at: now,
        updated_at: now,
      })),
      {
        ...blankSponsorship("affiliate"),
        id: "sample-affiliate",
        workspace_id: w,
        athlete_name: "Riley Brooks (sample)",
        sport: "Fitness creator",
        profile_url: "",
        rate: "10% commission",
        proposal: "Training videos and product reviews.",
        deliverables: "Two videos per month.",
        status: "pending",
        decided_by: null,
        decided_at: null,
        created_by: demoUser,
        version: 1,
        created_at: now,
        updated_at: now,
      },
      {
        ...blankSponsorship(),
        id: "sample-athlete",
        workspace_id: w,
        athlete_name: "Sam Taylor (sample)",
        sport: "MMA",
        audience: "Sample athlete",
        proposal: "MMA fighter. Product and fight-week content partnership.",
        requested_support: "Training products and fight-week support.",
        deliverables: "Two training videos and one fight recap.",
        timing: "Next month",
        status: "active",
        decided_by: null,
        decided_at: null,
        created_by: demoUser,
        version: 1,
        created_at: now,
        updated_at: now,
      },
    ],
    grants: [],
    activity: [],
    notifications: [
      {
        id: "sample-task-notification",
        workspace_id: w,
        recipient_id: demoUser,
        actor_id: members[1].user_id,
        actor_name: "Alex Rivera",
        item_id: "00000000-0000-4000-8000-000000000103",
        item_version: 1,
        task_title: "Edit the event recap reel",
        kind: "task_added",
        created_at: now,
        read_at: null,
      },
    ],
    items: [
      create(110, "event", "Sam Taylor vs. Chris Morgan", {
        athlete_id: "sample-athlete",
        event_type: "fight",
        starts_at: new Date(
          `${addDays(localDate(), 3)}T19:00:00`,
        ).toISOString(),
        location: "Sample arena",
        content_needs: "Weigh-in photos\nWalkout video\nPost-fight interview",
        category: "Content",
      }),
      event,
      create(101, "task", "Build the pop-up run of show", {
        assignee_id: demoUser,
        week_of: week,
        due_date: addDays(week, 3),
        status: "doing",
        priority: "high",
        event_id: event.id,
        definition_done:
          "One shared document covering timings, owners, setup and pack-down.",
      }),
      create(102, "task", "Capture 10 product-in-hand photos", {
        category: "Content",
        due_date: addDays(week, 5),
        week_of: week,
        event_id: event.id,
        definition_done:
          "10 edited portrait photos, uploaded to the shared folder. Capture all three flavors.",
      }),
      create(103, "task", "Edit the event recap reel", {
        category: "Content",
        assignee_id: members[2].user_id,
        collaborator_ids: [demoUser],
        week_of: week,
        due_date: addDays(week, 6),
        event_id: event.id,
        definition_done:
          "One 20–30 second vertical edit, with captions and a cover image.",
      }),
      create(104, "task", "Confirm event supplies", {
        assignee_id: members[1].user_id,
        week_of: week,
        due_date: addDays(week, 2),
        status: "done",
        delivery_notes: "Sample completion: supplies checklist is ready.",
        definition_done: "Confirm stock, signage, table setup and transport.",
      }),
      create(105, "task", "Draft next week’s content plan", {
        assignee_id: demoUser,
        week_of: week,
        due_date: addDays(week, 4),
        category: "Content",
        definition_done:
          "A seven-day plan with format, channel, owner and publish date.",
      }),
      create(106, "idea", "A “what keeps you moving?” interview series", {
        description: "Short community stories filmed at each event.",
        category: "Content",
      }),
      create(107, "idea", "Partner with local run clubs", {
        description: "Explore a recurring post-run Motion meetup.",
        category: "Community",
      }),
      create(108, "todo", "Review this week’s priorities", {
        assignee_id: demoUser,
      }),
    ],
  };
}
