/**
 * Generates a single self-contained SVG summarizing a GitHub profile.
 *
 * Usage: GITHUB_TOKEN=... deno task generate [--out profile.svg]
 */

import { Renderer } from "@takumi-rs/wasm/node";
import { fromJsx } from "@takumi-rs/helpers/jsx";
import type { ComponentChildren } from "preact";
import { dirname } from "@std/path";

const API = "https://api.github.com/graphql";

type LanguageEdge = {
  size: number;
  node: { name: string; color: string | null };
};
type Repository = {
  stargazerCount: number;
  forkCount: number;
  watchers: { totalCount: number };
  releases: { totalCount: number };
  languages: { edges: LanguageEdge[] };
};
type Day = { date: string; contributionCount: number; color: string };
type UserData = {
  name: string | null;
  login: string;
  avatarUrl: string;
  createdAt: string;
  followers: { totalCount: number };
  following: { totalCount: number };
  organizations: { totalCount: number };
  starredRepositories: { totalCount: number };
  watching: { totalCount: number };
  sponsoring: { totalCount: number };
  sponsors: { totalCount: number };
  issueComments: { totalCount: number };
  repositoriesContributedTo: { totalCount: number };
  allRepositories: { totalCount: number; totalDiskUsage: number };
  contributionsCollection: {
    totalCommitContributions: number;
    totalPullRequestContributions: number;
    totalIssueContributions: number;
    totalPullRequestReviewContributions: number;
    contributionCalendar: {
      totalContributions: number;
      weeks: { contributionDays: Day[] }[];
    };
  };
  repositories: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Repository[];
  };
};

// Repository fields are fetched separately: combining them with the profile
// query pushes GitHub past its GraphQL time limit and returns 504.
const REPOSITORIES_QUERY = `
query($login: String!, $after: String) {
  user(login: $login) {
    repositories(first: 50, after: $after, ownerAffiliations: OWNER, isFork: false) {
      pageInfo { hasNextPage endCursor }
      nodes {
        stargazerCount
        forkCount
        watchers { totalCount }
        releases { totalCount }
        languages(first: 20, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
  }
}`;

const PROFILE_QUERY = `
query($login: String!) {
  user(login: $login) {
    name
    login
    avatarUrl(size: 80)
    createdAt
    followers { totalCount }
    following { totalCount }
    organizations { totalCount }
    starredRepositories { totalCount }
    watching { totalCount }
    sponsoring { totalCount }
    sponsors { totalCount }
    issueComments { totalCount }
    repositoriesContributedTo(includeUserRepositories: true) { totalCount }
    allRepositories: repositories(ownerAffiliations: OWNER) { totalCount totalDiskUsage }
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      totalIssueContributions
      totalPullRequestReviewContributions
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount color } }
      }
    }
  }
}`;

async function graphql(
  token: string,
  query: string,
  variables: Record<string, unknown>,
) {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(
      `GraphQL request failed: ${res.status} ${await res.text()}`,
    );
  }
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data.user;
}

/**
 * Fetches the profile data, following repository pagination.
 */
export async function fetchUser(
  login: string,
  token: string,
): Promise<UserData> {
  const user: UserData = await graphql(token, PROFILE_QUERY, { login });
  user.repositories = {
    pageInfo: { hasNextPage: false, endCursor: null },
    nodes: [],
  };
  let after: string | null = null;
  do {
    const page = await graphql(token, REPOSITORIES_QUERY, { login, after });
    user.repositories.nodes.push(...page.repositories.nodes);
    after = page.repositories.pageInfo.hasNextPage
      ? page.repositories.pageInfo.endCursor
      : null;
  } while (after);
  return user;
}

/**
 * Downloads an image and encodes it as a data URI.
 * GitHub proxies README images through camo, which strips external references
 * inside SVGs, so the avatar has to travel inside the file.
 */
export async function toDataUri(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`avatar fetch failed: ${res.status}`);
  const type = res.headers.get("content-type") ?? "image/png";
  const bytes = new Uint8Array(await res.arrayBuffer());
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:${type};base64,${btoa(bin)}`;
}

function topLanguages(repos: Repository[], limit: number) {
  const bytes = new Map<string, { size: number; color: string }>();
  for (const r of repos) {
    for (const e of r.languages.edges) {
      const cur = bytes.get(e.node.name) ??
        { size: 0, color: e.node.color ?? "#959da5" };
      cur.size += e.size;
      bytes.set(e.node.name, cur);
    }
  }
  const total = [...bytes.values()].reduce((a, b) => a + b.size, 0) || 1;
  return {
    count: bytes.size,
    top: [...bytes.entries()]
      .sort((a, b) => b[1].size - a[1].size)
      .slice(0, limit)
      .map(([name, v]) => ({ name, color: v.color, ratio: v.size / total })),
  };
}

function yearsAgo(iso: string, now: Date): string {
  const years = Math.floor(
    (now.getTime() - new Date(iso).getTime()) / (365.25 * 24 * 3600 * 1000),
  );
  return years <= 0 ? "this year" : `${years} year${years > 1 ? "s" : ""} ago`;
}

function formatDiskUsage(kib: number): string {
  const gib = kib / 1024 / 1024;
  return gib >= 1 ? `${gib.toFixed(1)} GB` : `${(kib / 1024).toFixed(0)} MB`;
}

// Octicons (MIT, https://github.com/primer/octicons), 16px variants.
const ICONS: Record<string, string> = {
  clock:
    "M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm7-3.25v2.992l2.028.812a.75.75 0 0 1-.557 1.392l-2.5-1A.751.751 0 0 1 7 8.25v-3.5a.75.75 0 0 1 1.5 0Z",
  people:
    "M2 5.5a3.5 3.5 0 1 1 5.898 2.549 5.508 5.508 0 0 1 3.034 4.084.75.75 0 1 1-1.482.235 4 4 0 0 0-7.9 0 .75.75 0 0 1-1.482-.236A5.507 5.507 0 0 1 3.102 8.05 3.493 3.493 0 0 1 2 5.5ZM11 4a3.001 3.001 0 0 1 2.22 5.018 5.01 5.01 0 0 1 2.56 3.012.749.749 0 0 1-.885.954.752.752 0 0 1-.549-.514 3.507 3.507 0 0 0-2.522-2.372.75.75 0 0 1-.574-.73v-.352a.75.75 0 0 1 .416-.672A1.5 1.5 0 0 0 11 5.5.75.75 0 0 1 11 4Zm-5.5-.5a2 2 0 1 0-.001 3.999A2 2 0 0 0 5.5 3.5Z",
  graph:
    "M1.5 1.75V13.5h13.75a.75.75 0 0 1 0 1.5H.75a.75.75 0 0 1-.75-.75V1.75a.75.75 0 0 1 1.5 0Zm14.28 2.53-5.25 5.25a.75.75 0 0 1-1.06 0L7 7.06 4.28 9.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.25-3.25a.75.75 0 0 1 1.06 0L10 7.94l4.72-4.72a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042Z",
  commit:
    "M11.93 8.5a4.002 4.002 0 0 1-7.86 0H.75a.75.75 0 0 1 0-1.5h3.32a4.002 4.002 0 0 1 7.86 0h3.32a.75.75 0 0 1 0 1.5Zm-1.43-.75a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z",
  pr:
    "M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z",
  review:
    "M1.5 1.75V13.5h13.75a.75.75 0 0 1 0 1.5H.75a.75.75 0 0 1-.75-.75V1.75a.75.75 0 0 1 1.5 0Zm11.03 1.47a.75.75 0 0 1 1.06 1.06L7.06 10.81a.75.75 0 0 1-1.06 0L3.72 8.53a.75.75 0 0 1 1.06-1.06L6.53 9.22Z",
  issue:
    "M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z",
  comment:
    "M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z",
  org:
    "M1.75 16A1.75 1.75 0 0 1 0 14.25V1.75C0 .784.784 0 1.75 0h8.5C11.216 0 12 .784 12 1.75v12.5c0 .085-.006.168-.018.25h2.268a.25.25 0 0 0 .25-.25V8.285a.25.25 0 0 0-.111-.208l-1.055-.703a.749.749 0 1 1 .832-1.248l1.055.703c.487.325.779.871.779 1.456v5.965A1.75 1.75 0 0 1 14.25 16h-3.5a.766.766 0 0 1-.197-.026c-.099.017-.2.026-.303.026h-3a.75.75 0 0 1-.75-.75V14h-1v1.25a.75.75 0 0 1-.75.75Zm-.25-1.75c0 .138.112.25.25.25H4v-1.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 .75.75v1.25h2.25a.25.25 0 0 0 .25-.25V1.75a.25.25 0 0 0-.25-.25h-8.5a.25.25 0 0 0-.25.25ZM3.75 6h.5a.75.75 0 0 1 0 1.5h-.5a.75.75 0 0 1 0-1.5ZM3 3.75A.75.75 0 0 1 3.75 3h.5a.75.75 0 0 1 0 1.5h-.5A.75.75 0 0 1 3 3.75Zm4 3A.75.75 0 0 1 7.75 6h.5a.75.75 0 0 1 0 1.5h-.5A.75.75 0 0 1 7 6.75ZM7.75 3h.5a.75.75 0 0 1 0 1.5h-.5a.75.75 0 0 1 0-1.5ZM3 9.75A.75.75 0 0 1 3.75 9h.5a.75.75 0 0 1 0 1.5h-.5A.75.75 0 0 1 3 9.75ZM7.75 9h.5a.75.75 0 0 1 0 1.5h-.5a.75.75 0 0 1 0-1.5Z",
  heart:
    "m8 14.25.345.666a.75.75 0 0 1-.69 0l-.008-.004-.018-.01a7.152 7.152 0 0 1-.31-.17 22.055 22.055 0 0 1-3.434-2.414C2.045 10.731 0 8.35 0 5.5 0 2.836 2.086 1 4.25 1 5.797 1 7.153 1.802 8 3.02 8.847 1.802 10.203 1 11.75 1 13.914 1 16 2.836 16 5.5c0 2.85-2.045 5.231-3.885 6.818a22.066 22.066 0 0 1-3.744 2.584l-.018.01-.006.003h-.002ZM4.25 2.5c-1.336 0-2.75 1.164-2.75 3 0 2.15 1.58 4.144 3.365 5.682A20.58 20.58 0 0 0 8 13.393a20.58 20.58 0 0 0 3.135-2.211C12.92 9.644 14.5 7.65 14.5 5.5c0-1.836-1.414-3-2.75-3-1.373 0-2.609.986-3.029 2.456a.749.749 0 0 1-1.442 0C6.859 3.486 5.623 2.5 4.25 2.5Z",
  star:
    "M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Zm0 2.445L6.615 5.5a.75.75 0 0 1-.564.41l-3.097.45 2.24 2.184a.75.75 0 0 1 .216.664l-.528 3.084 2.769-1.456a.75.75 0 0 1 .698 0l2.77 1.456-.53-3.084a.75.75 0 0 1 .216-.664l2.24-2.183-3.096-.45a.75.75 0 0 1-.564-.41L8 2.694Z",
  eye:
    "M8 2c1.981 0 3.671.992 4.933 2.078 1.27 1.091 2.187 2.345 2.637 3.023a1.62 1.62 0 0 1 0 1.798c-.45.678-1.367 1.932-2.637 3.023C11.67 13.008 9.981 14 8 14c-1.981 0-3.671-.992-4.933-2.078C1.797 10.83.88 9.576.43 8.898a1.62 1.62 0 0 1 0-1.798c.45-.677 1.367-1.931 2.637-3.022C4.33 2.992 6.019 2 8 2ZM1.679 7.932a.12.12 0 0 0 0 .136c.411.622 1.241 1.75 2.366 2.717C5.176 11.758 6.527 12.5 8 12.5c1.473 0 2.825-.742 3.955-1.715 1.124-.967 1.954-2.096 2.366-2.717a.12.12 0 0 0 0-.136c-.412-.621-1.242-1.75-2.366-2.717C10.824 4.242 9.473 3.5 8 3.5c-1.473 0-2.825.742-3.955 1.715-1.124.967-1.954 2.096-2.366 2.717ZM8 10a2 2 0 1 1-.001-3.999A2 2 0 0 1 8 10Z",
  repo:
    "M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z",
  fork:
    "M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z",
  tag:
    "M1 7.775V2.75C1 1.784 1.784 1 2.75 1h5.025c.464 0 .91.184 1.238.513l6.25 6.25a1.75 1.75 0 0 1 0 2.474l-5.026 5.026a1.75 1.75 0 0 1-2.474 0l-6.25-6.25A1.752 1.752 0 0 1 1 7.775Zm1.5 0c0 .066.026.13.073.177l6.25 6.25a.25.25 0 0 0 .354 0l5.025-5.025a.25.25 0 0 0 0-.354l-6.25-6.25a.25.25 0 0 0-.177-.073H2.75a.25.25 0 0 0-.25.25ZM6 5a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z",
  database:
    "M1 3.5c0-.626.292-1.165.7-1.59.406-.422.956-.767 1.579-1.041C4.525.32 6.195 0 8 0c1.805 0 3.475.32 4.722.869.622.274 1.172.62 1.578 1.04.408.426.7.965.7 1.591v9c0 .626-.292 1.165-.7 1.59-.406.422-.956.767-1.579 1.041C11.476 15.68 9.806 16 8 16c-1.805 0-3.475-.32-4.721-.869-.623-.274-1.173-.62-1.579-1.04-.408-.426-.7-.965-.7-1.591Zm1.5 0c0 .133.058.318.282.551.227.237.591.483 1.101.707C4.898 5.205 6.353 5.5 8 5.5c1.646 0 3.101-.295 4.118-.742.508-.224.873-.471 1.1-.708.224-.232.282-.417.282-.55 0-.133-.058-.318-.282-.551-.227-.237-.591-.483-1.101-.707C11.102 1.795 9.647 1.5 8 1.5c-1.646 0-3.101.295-4.118.742-.508.224-.873.471-1.1.708-.224.232-.282.417-.282.55Zm0 4.5c0 .133.058.318.282.551.227.237.591.483 1.101.707C4.898 9.705 6.353 10 8 10c1.646 0 3.101-.295 4.118-.742.508-.224.873-.471 1.1-.708.224-.232.282-.417.282-.55V5.724c-.241.15-.503.286-.778.407C11.475 6.68 9.805 7 8 7c-1.805 0-3.475-.32-4.721-.869a6.15 6.15 0 0 1-.779-.407Zm0 2.225V12.5c0 .133.058.318.282.55.227.237.592.484 1.1.708 1.016.447 2.471.742 4.118.742 1.647 0 3.102-.295 4.117-.742.51-.224.874-.47 1.101-.707.224-.233.282-.418.282-.551v-2.275c-.241.15-.503.285-.778.406-1.246.549-2.916.869-4.722.869-1.806 0-3.476-.32-4.722-.869a6.198 6.198 0 0 1-.778-.406Z",
  code:
    "M4.72 3.22a.75.75 0 0 1 1.06 1.06L2.06 8l3.72 3.72a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L.47 8.53a.75.75 0 0 1 0-1.06l4.25-4.25Zm6.56 0a.75.75 0 1 0-1.06 1.06L13.94 8l-3.72 3.72a.749.749 0 0 0 .326 1.275.749.749 0 0 0 .734-.215l4.25-4.25a.75.75 0 0 0 0-1.06l-4.25-4.25Z",
};

function byMonth(days: Day[]): { label: string; count: number }[] {
  const months = new Map<string, number>();
  for (const d of days) {
    const key = d.date.slice(0, 7);
    months.set(key, (months.get(key) ?? 0) + d.contributionCount);
  }
  return [...months.entries()].map(([key, count]) => ({
    label: `${key.slice(2, 4)}/${key.slice(5, 7)}`,
    count,
  }));
}

const WIDTH = 480;
const HEADING = "#0366d6";
const TEXT = "#777";
const ICON = "#959da5";

const STYLESHEET = `
.root { display: flex; flex-direction: column; width: ${WIDTH}px; padding: 10px; background: #fff; font-size: 14px; color: ${TEXT}; }
.row { display: flex; }
.col { display: flex; flex-direction: column; flex: 1; }
.section { display: flex; flex-direction: column; margin-top: 12px; }
.field { display: flex; align-items: center; height: 19px; }
.field img { margin-right: 8px; }
.heading { display: flex; align-items: center; height: 22px; font-size: 16px; color: ${HEADING}; }
.heading img { margin-right: 8px; }
.title { display: flex; align-items: center; height: 24px; }
.title span { font-size: 20px; font-weight: 700; color: ${HEADING}; }
.avatar { margin-right: 6px; border-radius: 50%; }
.bar { display: flex; height: 8px; margin: 14px 0 12px 24px; }
.legend { display: flex; flex-wrap: wrap; padding-left: 24px; }
.legend .field { width: 50%; }
.legend .dot { width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; }
.legend .pct { color: ${ICON}; margin-left: 4px; }
`;

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function Icon({ name, fill = ICON }: { name: string; fill?: string }) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16"><path fill="${fill}" d="${
      ICONS[name]
    }"/></svg>`;
  return <img src={svgDataUri(svg)} width={16} height={16} />;
}

function Field({ icon, children }: { icon: string; children: string }) {
  return (
    <div class="field">
      <Icon name={icon} />
      <span>{children}</span>
    </div>
  );
}

function Heading({ icon, children }: { icon: string; children: string }) {
  return (
    <div class="heading">
      <Icon name={icon} fill={HEADING} />
      <span>{children}</span>
    </div>
  );
}

function Section(
  { title, rows }: { title?: ComponentChildren; rows: [string, string][] },
) {
  return (
    <div class="section">
      {title ?? <div class="heading" />}
      {rows.map(([icon, text]) => <Field icon={icon}>{text}</Field>)}
    </div>
  );
}

function MonthlyChart({ days, w, h }: { days: Day[]; w: number; h: number }) {
  const months = byMonth(days);
  const peak = Math.max(...months.map((m) => m.count), 1);
  const left = 24;
  const top = 6;
  const bottom = 14;
  const plotW = w - left - 14;
  const plotH = h - top - bottom;
  const px = (i: number) => left + (i / Math.max(months.length - 1, 1)) * plotW;
  const py = (n: number) => top + plotH - (n / peak) * plotH;
  const line = months
    .map((m, i) => `${px(i).toFixed(1)},${py(m.count).toFixed(1)}`)
    .join(" ");
  const labels = months
    .map((m, i) =>
      i % 3 === 0
        ? `<text x="${px(i).toFixed(1)}" y="${
          h - 2
        }" font-size="8" text-anchor="middle" fill="${ICON}">${m.label}</text>`
        : ""
    )
    .join("");
  // The chart stays a hand-written SVG string: takumi embeds <img> SVGs as
  // vector data URIs, whereas inline <svg> elements are not laid out by it.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="sans-serif">
<text x="${left - 3}" y="${
      top + 3
    }" font-size="8" text-anchor="end" fill="${ICON}">${peak}</text>
<line x1="${left}" y1="${top}" x2="${left + plotW}" y2="${top}" stroke="#eee"/>
<polygon points="${left},${top + plotH} ${line} ${left + plotW},${
      top + plotH
    }" fill="${HEADING}" fill-opacity="0.15"/>
<polyline points="${line}" fill="none" stroke="${HEADING}" stroke-width="1.5" stroke-linejoin="round"/>
${labels}
</svg>`;
  return <img src={svgDataUri(svg)} width={w} height={h} />;
}

/**
 * The profile card as a component tree that takumi lays out and renders.
 */
export function ProfileCard(
  { user, avatar, now }: { user: UserData; avatar: string; now: Date },
) {
  const c = user.contributionsCollection;
  const repos = user.repositories.nodes;
  const sum = (f: (r: Repository) => number) =>
    repos.reduce((a, r) => a + f(r), 0);
  const langs = topLanguages(repos, 8);
  const days = c.contributionCalendar.weeks
    .flatMap((w) => w.contributionDays)
    .slice(-364);

  return (
    <div class="root">
      <div class="title">
        <img class="avatar" src={avatar} width={20} height={20} />
        <span>{user.name ?? user.login}</span>
      </div>
      <div class="row">
        <div class="col">
          <Field icon="clock">
            {`Joined GitHub ${yearsAgo(user.createdAt, now)}`}
          </Field>
          <Field icon="people">
            {`Followed by ${user.followers.totalCount} users`}
          </Field>
        </div>
        <div class="col">
          <MonthlyChart days={days} w={WIDTH / 2 - 20} h={44} />
          <Field icon="repo">
            {`Contributed to ${user.repositoriesContributedTo.totalCount} repositories`}
          </Field>
        </div>
      </div>
      <div class="row">
        <div class="col">
          <Section
            title={<Heading icon="graph">Activity</Heading>}
            rows={[
              ["commit", `${c.totalCommitContributions} Commits`],
              [
                "review",
                `${c.totalPullRequestReviewContributions} Pull requests reviewed`,
              ],
              ["pr", `${c.totalPullRequestContributions} Pull requests opened`],
              ["issue", `${c.totalIssueContributions} Issues opened`],
              ["comment", `${user.issueComments.totalCount} issue comments`],
            ]}
          />
        </div>
        <div class="col">
          <Section
            title={<Heading icon="people">Community stats</Heading>}
            rows={[
              [
                "org",
                `Member of ${user.organizations.totalCount} organizations`,
              ],
              ["people", `Following ${user.following.totalCount} users`],
              [
                "heart",
                `Sponsoring ${user.sponsoring.totalCount} repositories`,
              ],
              [
                "star",
                `Starred ${user.starredRepositories.totalCount} repositories`,
              ],
              ["eye", `Watching ${user.watching.totalCount} repositories`],
            ]}
          />
        </div>
      </div>
      <div class="row">
        <div class="col">
          <Section
            title={
              <Heading icon="repo">
                {`${user.allRepositories.totalCount} Repositories`}
              </Heading>
            }
            rows={[
              ["tag", `${sum((r) => r.releases.totalCount)} Releases`],
              [
                "database",
                `${formatDiskUsage(user.allRepositories.totalDiskUsage)} used`,
              ],
            ]}
          />
        </div>
        <div class="col">
          <Section
            rows={[
              ["heart", `${user.sponsors.totalCount} Sponsors`],
              ["star", `${sum((r) => r.stargazerCount)} Stargazers`],
              ["fork", `${sum((r) => r.forkCount)} Forkers`],
              ["eye", `${sum((r) => r.watchers.totalCount)} Watchers`],
            ]}
          />
        </div>
      </div>
      <div class="section">
        <Heading icon="code">{`${langs.count} Languages`}</Heading>
        <div class="bar">
          {langs.top.map((l) => (
            <div
              style={{
                width: `${(l.ratio * 100).toFixed(2)}%`,
                background: l.color,
              }}
            />
          ))}
        </div>
        <div class="legend">
          {langs.top.map((l) => (
            <div class="field">
              <div class="dot" style={{ background: l.color }} />
              <span>{l.name}</span>
              <span class="pct">{`${(l.ratio * 100).toFixed(1)}%`}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Renders the profile card to a self-contained SVG string.
 */
export async function render(
  user: UserData,
  avatar: string,
  now: Date,
): Promise<string> {
  const { node } = await fromJsx(
    <ProfileCard user={user} avatar={avatar} now={now} />,
  );
  const renderer = new Renderer();
  return await renderer.renderSvg(node, {
    width: WIDTH,
    stylesheets: [STYLESHEET],
  });
}

if (import.meta.main) {
  const token = Deno.env.get("GITHUB_TOKEN");
  if (!token) throw new Error("GITHUB_TOKEN is required");
  const login = Deno.env.get("GITHUB_USER") ?? "Omochice";
  const outIdx = Deno.args.indexOf("--out");
  const out = outIdx >= 0 ? Deno.args[outIdx + 1] : "profile.svg";

  const user = await fetchUser(login, token);
  const avatar = await toDataUri(user.avatarUrl);
  await Deno.mkdir(dirname(out), { recursive: true });
  await Deno.writeTextFile(out, await render(user, avatar, new Date()));
  console.log(`wrote ${out}`);
}
