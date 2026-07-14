/**
 * arcCRM ClickUp Sync — bidirectional, Sales space only
 * GET  → pull tasks from ClickUp into GitHub (clickup-data.json)
 * POST → push a task update from arcCRM to ClickUp
 */
const { writeGitHubFile, readGitHubFile } = require("./github");

const CU = "https://api.clickup.com/api/v2";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

function respond(status, body) {
  return { statusCode: status, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

async function cuGet(path, key) {
  const r = await fetch(CU + path, { headers: { Authorization: key } });
  if (!r.ok) throw new Error(`ClickUp ${r.status}: ${r.statusText}`);
  return r.json();
}

async function cuPatch(path, key, body) {
  const r = await fetch(CU + path, {
    method: "PUT",
    headers: { Authorization: key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`ClickUp update ${r.status}: ${r.statusText}`);
  return r.json();
}

async function pullFromClickUp(key, spaceId) {
  // Get all lists in the Sales space
  let allLists = [];
  try {
    const folders = await cuGet(`/space/${spaceId}/folder?archived=false`, key);
    for (const f of (folders.folders || []).slice(0, 10)) {
      const lr = await cuGet(`/folder/${f.id}/list?archived=false`, key);
      allLists = allLists.concat((lr.lists || []).map(l => ({ ...l, folder_name: f.name })));
    }
  } catch (e) { console.warn("Folder fetch:", e.message); }
  try {
    const nfl = await cuGet(`/space/${spaceId}/list?archived=false`, key);
    allLists = allLists.concat(nfl.lists || []);
  } catch (e) { console.warn("No-folder list fetch:", e.message); }

  // Get tasks from all lists
  let allTasks = [];
  for (const list of allLists.slice(0, 20)) {
    try {
      const tr = await cuGet(`/list/${list.id}/task?archived=false&include_closed=true&limit=100`, key);
      const tasks = (tr.tasks || []).map(t => ({
        id:          t.id,
        name:        t.name,
        description: t.description || "",
        status:      t.status?.status || "",
        priority:    t.priority?.priority || "",
        assignees:   (t.assignees || []).map(a => ({ id: a.id, username: a.username, email: a.email })),
        due_date:    t.due_date,
        start_date:  t.start_date,
        date_updated:t.date_updated,
        tags:        (t.tags || []).map(t => t.name),
        list_id:     list.id,
        list_name:   list.name,
        folder_name: list.folder_name || "",
        url:         t.url,
      }));
      allTasks = allTasks.concat(tasks);
    } catch (e) { console.warn(`List ${list.id}:`, e.message); }
  }

  const data = {
    space_id:   spaceId,
    lists:      allLists.map(l => ({ id: l.id, name: l.name, folder_name: l.folder_name || "" })),
    tasks:      allTasks,
  };
  await writeGitHubFile("clickup-data.json", data);
  return { lists: allLists.length, tasks: allTasks.length };
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };

  const key     = process.env.CLICKUP_API_KEY;
  const spaceId = process.env.CLICKUP_SPACE_ID;
  if (!key)     return respond(500, { error: "Missing CLICKUP_API_KEY" });
  if (!spaceId) return respond(500, { error: "Missing CLICKUP_SPACE_ID" });

  // GET = pull from ClickUp
  if (event.httpMethod === "GET" || !event.body) {
    try {
      const counts = await pullFromClickUp(key, spaceId);
      return respond(200, { success: true, synced_at: new Date().toISOString(), counts });
    } catch (err) {
      return respond(500, { error: err.message });
    }
  }

  // POST = push update to ClickUp
  let body;
  try { body = JSON.parse(event.body); } catch { return respond(400, { error: "Invalid JSON" }); }

  const { task_id, name, status, priority, due_date, assignees, description } = body;
  if (!task_id) return respond(400, { error: "task_id required" });

  try {
    const updatePayload = {};
    if (name        !== undefined) updatePayload.name        = name;
    if (description !== undefined) updatePayload.description = description;
    if (status      !== undefined) updatePayload.status      = status;
    if (priority    !== undefined) updatePayload.priority    = priority;
    if (due_date    !== undefined) updatePayload.due_date    = due_date;
    if (assignees   !== undefined) updatePayload.assignees   = assignees;

    const updated = await cuPatch(`/task/${task_id}`, key, updatePayload);

    // After push, re-pull to keep GitHub in sync
    await pullFromClickUp(key, spaceId);

    return respond(200, { success: true, task: updated });
  } catch (err) {
    return respond(500, { error: err.message });
  }
};
