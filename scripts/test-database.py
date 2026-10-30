"""Integration assertions against a named, disposable local container only."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
import sys
import time

container = sys.argv[1]
if not container.startswith("travel-calendrier-pg-test-"):
    raise SystemExit("Refusing to run against a non-test container")

def sql(query, ok=True, database="postgres"):
    result = subprocess.run(
        ["docker", "exec", "-i", container, "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database],
        input=query, text=True, capture_output=True,
    )
    if ok and result.returncode:
        raise AssertionError(result.stderr)
    return result

def op(operation):
    # JSON is fed through stdin with a dollar quote delimiter absent from fixtures.
    return sql("set role anon; select public.apply_trip_operation($op$" + json.dumps(operation, ensure_ascii=False) + "$op$::jsonb);", ok=False)

def assert_pass(condition, label):
    assert condition, label
    print("PASS:", label)

def activity(activity_id):
    return {"id": activity_id, "revision": 1, "date": "2026-10-31", "time": "10:00", "endTime": "12:00", "title": "Start", "location": "Place", "note": "", "category": "explore", "sortOrder": 100}

def state():
    return json.loads(sql("select state from public.trip_boards where id='toulouse-2026';").stdout)

for role in ("anon", "authenticated"):
    for verb, query in (
        ("insert", "insert into public.trip_boards(id,state) values ('attack','{}');"),
        ("update", "update public.trip_boards set state='{}' where id='toulouse-2026';"),
        ("delete", "delete from public.trip_boards where id='toulouse-2026';"),
        ("truncate", "truncate public.trip_boards;"),
        ("log read", "select * from travel_private.trip_operations;"),
    ):
        result = sql(f"set role {role}; " + query, ok=False)
        assert_pass(result.returncode != 0 and "permission denied" in result.stderr, f"{role} actual {verb} denied")

initial = state()
assert_pass(initial == json.load(open("supabase/seed.json")), "SQL seed matches checked-in canonical state")
create = {"id": "concurrent-create", "type": "create", "activity": activity("concurrent-item")}
with ThreadPoolExecutor(max_workers=8) as executor:
    duplicates = list(executor.map(op, [create] * 8))
assert_pass(all(r.returncode == 0 for r in duplicates), "eight simultaneous retries all succeed")
assert_pass(sum(json.loads(r.stdout).get("duplicate", False) for r in duplicates) == 7, "simultaneous retry applies exactly once")
assert_pass(state()["version"] == initial["version"] + 1, "retry race increments version once")

updates = [
    {"id": "concurrent-title", "type": "update", "activityId": "concurrent-item", "patch": {"title": "New title"}, "base": {"title": "Start"}},
    {"id": "concurrent-location", "type": "update", "activityId": "concurrent-item", "patch": {"location": "New place"}, "base": {"location": "Place"}},
]
with ThreadPoolExecutor(max_workers=2) as executor:
    results = list(executor.map(op, updates))
assert_pass(all(r.returncode == 0 for r in results), "simultaneous edits to distinct fields both succeed")
item = next(a for a in state()["activities"] if a["id"] == "concurrent-item")
assert_pass(item["title"] == "New title" and item["location"] == "New place" and item["revision"] == 3, "row lock preserves merged field values")

collisions = [
    {"id": f"title-race-{n}", "type": "update", "activityId": "concurrent-item", "patch": {"title": f"Racer {n}"}, "base": {"title": "New title"}}
    for n in range(2)
]
with ThreadPoolExecutor(max_workers=2) as executor:
    results = list(executor.map(op, collisions))
assert_pass(sum(r.returncode == 0 for r in results) == 1 and sum("CONFLICT:" in r.stderr for r in results) == 1, "simultaneous same-field edits produce one success and one conflict")

members = ["hoting", "mia", "james", "ganggang", "kada"]
participations = [{"id": f"participation-{m}", "type": "participate", "activityId": "concurrent-item", "memberId": m, "status": "going"} for m in members]
with ThreadPoolExecutor(max_workers=5) as executor:
    results = list(executor.map(op, participations))
assert_pass(all(r.returncode == 0 for r in results), "five concurrent member responses all succeed")
assert_pass(len([r for r in state()["responses"] if r["activityId"] == "concurrent-item"]) == 5, "concurrent participation loses no member")

current = state()
version = current["version"]
assert_pass(version == initial["version"] + 9, "all concurrent successful operations have monotonic version")
new_op = {"id": "conflicting-request-id", "type": "react", "activityId": "concurrent-item", "memberId": "mia", "emoji": "🎉", "active": True}
other_op = new_op | {"active": False}
with ThreadPoolExecutor(max_workers=2) as executor:
    results = list(executor.map(op, [new_op, other_op]))
assert_pass(sum(r.returncode == 0 for r in results) == 1 and sum("CONFLICT:" in r.stderr for r in results) == 1, "same operation id with different concurrent payload applies only one")

# Confirming different options concurrently is serializable: the later valid intent
# wins, and retrying either operation cannot reverse that final choice.
assert op({"id": "race-choice-create", "type": "create", "activity": activity("choice-race-other")}).returncode == 0
choice_ops = [
    {"id": "race-choice-a", "type": "participate", "activityId": "concurrent-item", "memberId": "mia", "status": "going"},
    {"id": "race-choice-b", "type": "participate", "activityId": "choice-race-other", "memberId": "mia", "status": "going"},
]
with ThreadPoolExecutor(max_workers=2) as executor:
    results = list(executor.map(op, choice_ops))
assert_pass(all(r.returncode == 0 for r in results), "simultaneous alternative confirmations both finish atomically")
choice_final = state()
assert_pass(len([r for r in choice_final["responses"] if r["memberId"] == "mia" and r["status"] == "going" and r["activityId"] in ("concurrent-item", "choice-race-other")]) == 1, "concurrent alternative confirmations retain exactly one final choice")
for request in choice_ops:
    assert json.loads(op(request).stdout)["duplicate"] is True
assert_pass(state() == choice_final, "retrying either concurrent choice cannot reverse the final selection")
assert_pass(len([r for r in choice_final["responses"] if r["memberId"] != "mia" and r["status"] == "going" and r["activityId"] == "concurrent-item"]) == 4, "concurrent choice switch preserves the other four members")

# Two confirmations reviewed against the same empty slot: only the first may apply.
for suffix in ("a", "b"):
    new_activity = activity("guard-race-" + suffix) | {"time": "16:00", "endTime": "17:00"}
    assert op({"id": "guard-race-create-" + suffix, "type": "create", "activity": new_activity}).returncode == 0
guarded_choices = [
    {"id": "guard-race-confirm-" + suffix, "type": "participate", "activityId": "guard-race-" + suffix,
     "memberId": "mia", "status": "going", "choice": {"key": "2026-10-31|16:00|17:00", "previousIds": []}}
    for suffix in ("a", "b")
]
with ThreadPoolExecutor(max_workers=2) as executor:
    results = list(executor.map(op, guarded_choices))
assert_pass(sum(r.returncode == 0 for r in results) == 1 and sum("CONFLICT:" in r.stderr for r in results) == 1, "simultaneous guarded confirmations allow one reviewed intent and conflict the other")
assert_pass(len([r for r in state()["responses"] if r["memberId"] == "mia" and r["status"] == "going" and r["activityId"].startswith("guard-race-")]) == 1, "guard race cannot silently switch the winner")

# Hold the board lock after a remote movement, then submit the old confirmation.
# The guard must compare after acquiring the lock, against the committed new slot.
move_target = activity("guard-lock-target") | {"date": "2026-11-02", "time": "08:00", "endTime": ""}
assert op({"id": "guard-lock-create", "type": "create", "activity": move_target}).returncode == 0
remote_move = {"id": "guard-lock-move", "type": "update", "activityId": "guard-lock-target", "patch": {"time": "09:00"}, "base": {"time": "08:00"}}
move_query = "set application_name='travel_guard_mover'; begin; set local role anon; select public.apply_trip_operation($op$" + json.dumps(remote_move) + "$op$::jsonb); select pg_sleep(0.8); commit;"
with ThreadPoolExecutor(max_workers=1) as executor:
    mover = executor.submit(sql, move_query)
    for _ in range(100):
        sleeping = sql("select count(*) from pg_stat_activity where application_name='travel_guard_mover' and wait_event='PgSleep';").stdout.strip()
        if sleeping == "1":
            break
        time.sleep(0.01)
    else:
        raise AssertionError("Remote mover did not reach its lock-holding checkpoint")
    stale_confirm = op({"id": "guard-lock-stale-confirm", "type": "participate", "activityId": "guard-lock-target", "memberId": "mia", "status": "going", "choice": {"key": "2026-11-02|08:00|", "previousIds": []}})
    mover.result()
assert_pass(stale_confirm.returncode != 0 and "CONFLICT:" in stale_confirm.stderr, "confirmation waiting behind remote movement checks latest slot after lock")
locked_state = state()
assert_pass(not any(r["activityId"] == "guard-lock-target" for r in locked_state["responses"]), "stale confirmation after concurrent movement leaves participation unchanged")
assert_pass(next(a for a in locked_state["activities"] if a["id"] == "guard-lock-target")["time"] == "09:00", "guard conflict preserves committed remote movement")

# Different intervals, not just equal slots, share the same locked guard check.
overlap_intervals = [("overlap-race-a", "12:10", "13:30"), ("overlap-race-b", "13:00", "14:00")]
for item_id, start, end in overlap_intervals:
    assert op({"id": "create-" + item_id, "type": "create", "activity": activity(item_id) | {"date": "2026-11-01", "time": start, "endTime": end}}).returncode == 0
overlap_confirmations = [
    {"id": "confirm-" + item_id, "type": "participate", "activityId": item_id, "memberId": "ganggang", "status": "going",
     "choice": {"key": f"2026-11-01|{start}|{end}", "previousIds": []}}
    for item_id, start, end in overlap_intervals
]
with ThreadPoolExecutor(max_workers=2) as executor:
    results = list(executor.map(op, overlap_confirmations))
assert_pass(sum(r.returncode == 0 for r in results) == 1 and sum("CONFLICT:" in r.stderr for r in results) == 1, "concurrent guarded confirmations on unequal overlapping intervals allow one winner")
assert_pass(len([r for r in state()["responses"] if r["memberId"] == "ganggang" and r["status"] == "going" and r["activityId"].startswith("overlap-race-")]) == 1, "overlap race preserves exactly one reviewed confirmation")

# The endpoints of an overlap graph are independent if they do not directly overlap.
chain_intervals = [("concurrent-chain-a", "08:30", "09:30"), ("concurrent-chain-b", "09:00", "11:00"), ("concurrent-chain-c", "10:30", "11:30")]
for item_id, start, end in chain_intervals:
    assert op({"id": "create-" + item_id, "type": "create", "activity": activity(item_id) | {"date": "2026-11-02", "time": start, "endTime": end}}).returncode == 0
endpoint_confirmations = [
    {"id": "confirm-" + item_id, "type": "participate", "activityId": item_id, "memberId": "hoting", "status": "going",
     "choice": {"key": f"2026-11-02|{start}|{end}", "previousIds": []}}
    for item_id, start, end in (chain_intervals[0], chain_intervals[2])
]
with ThreadPoolExecutor(max_workers=2) as executor:
    results = list(executor.map(op, endpoint_confirmations))
assert_pass(all(r.returncode == 0 for r in results), "concurrent disjoint chain endpoints both confirm despite shared bridge")
assert_pass(len([r for r in state()["responses"] if r["memberId"] == "hoting" and r["status"] == "going" and r["activityId"].startswith("concurrent-chain-")]) == 2, "overlap graph connectivity does not impose transitive exclusivity")
assert op({"id": "confirm-concurrent-chain-bridge", "type": "participate", "activityId": "concurrent-chain-b", "memberId": "hoting", "status": "going", "choice": {"key": "2026-11-02|09:00|11:00", "previousIds": ["concurrent-chain-a", "concurrent-chain-c"]}}).returncode == 0
assert_pass([r["activityId"] for r in state()["responses"] if r["memberId"] == "hoting" and r["status"] == "going" and r["activityId"].startswith("concurrent-chain-")] == ["concurrent-chain-b"], "guarded bridge atomically replaces both concurrently confirmed endpoints")

# Profiles use the same locked row and ledger while keeping stable member IDs.
profile_before = state()
profile_edits = [
    {"id": "concurrent-profile-name", "type": "profile", "memberId": "mia", "patch": {"name": "Mimi"}, "base": {"name": "Mia"}},
    {"id": "concurrent-profile-avatar", "type": "profile", "memberId": "mia", "patch": {"avatar": "🐱"}, "base": {"avatar": ""}},
]
with ThreadPoolExecutor(max_workers=2) as executor:
    results = list(executor.map(op, profile_edits))
assert_pass(all(r.returncode == 0 for r in results), "simultaneous profile edits to name and avatar both merge")
assert_pass(state()["profiles"]["mia"] == {"name": "Mimi", "avatar": "🐱"}, "profile field merge keeps both independently edited values")
profile_collisions = [
    {"id": f"profile-name-race-{n}", "type": "profile", "memberId": "mia", "patch": {"name": f"Mimi {n}"}, "base": {"name": "Mimi"}}
    for n in range(2)
]
with ThreadPoolExecutor(max_workers=2) as executor:
    results = list(executor.map(op, profile_collisions))
assert_pass(sum(r.returncode == 0 for r in results) == 1 and sum("CONFLICT:" in r.stderr for r in results) == 1, "simultaneous nickname edits allow one winner and reject the stale draft")
profile_duplicate = {"id": "concurrent-profile-duplicate", "type": "profile", "memberId": "hoting", "patch": {"name": "H", "avatar": "🚀"}, "base": {"name": "Hoting", "avatar": ""}}
with ThreadPoolExecutor(max_workers=5) as executor:
    results = list(executor.map(op, [profile_duplicate] * 5))
assert_pass(all(r.returncode == 0 for r in results) and sum(json.loads(r.stdout).get("duplicate", False) for r in results) == 4, "five concurrent profile retries apply one exact operation")
assert_pass(state()["version"] == profile_before["version"] + 4, "profile success and conflict races advance version only for four unique successes")
assert_pass(all(state()[field] == profile_before[field] for field in ("activities", "responses", "reactions")), "concurrent profile changes never alter itinerary revisions or stable member votes")
assert op({"id": "profile-after-duplicate", "type": "profile", "memberId": "hoting", "patch": {"name": "Hoting new"}, "base": {"name": "H"}}).returncode == 0
retried_profile = json.loads(op(profile_duplicate).stdout)
assert_pass(retried_profile["duplicate"] and retried_profile["state"]["profiles"]["hoting"]["name"] == "Hoting new", "old profile retry returns latest nickname without reverting a newer edit")

# Re-running deployment after actual writes must preserve edits and the dedupe ledger.
before = state()
for migration_path in sorted(Path("supabase/migrations").glob("*.sql")):
    sql(migration_path.read_text())
assert_pass(state() == before, "migration rerun preserves existing edits")
assert_pass(json.loads(op(create).stdout)["duplicate"] is True, "migration rerun preserves operation ledger")
assert_pass(json.loads(op(profile_duplicate).stdout)["duplicate"] is True, "migration rerun preserves profile state and retry ledger")

# Admin-only additional row; neither public role may observe it.
sql("insert into public.trip_boards(id,state) values ('another-board','{\"version\":0,\"activities\":[],\"responses\":[],\"reactions\":[]}');")
for role in ("anon", "authenticated"):
    visible = sql(f"set role {role}; select count(*) from public.trip_boards;").stdout.strip()
    assert_pass(visible == "1", f"{role} sees only the authorized trip even with another row present")

# Apply the copy migration to an existing edited board in a second disposable DB.
# This verifies deployment behavior, not merely the new empty-project seed.
copy_database = "trip_copy_migration_test"
sql("create database " + copy_database + ";")
for migration_path in sorted(Path("supabase/migrations").glob("*.sql")):
    if migration_path.name.startswith("202610300004"):
        break
    sql(migration_path.read_text(), database=copy_database)

def copy_state():
    return json.loads(sql("select state from public.trip_boards where id='toulouse-2026';", database=copy_database).stdout)

def copy_op(operation):
    return sql("set role anon; select public.apply_trip_operation($op$" + json.dumps(operation, ensure_ascii=False) + "$op$::jsonb);", database=copy_database)

old_seed = copy_state()
old_by_id = {a["id"]: a for a in old_seed["activities"]}
copy_op({"id": "copy-custom-title", "type": "update", "activityId": "arrival", "patch": {"title": "Our arrival plan"}, "base": {"title": old_by_id["arrival"]["title"]}})
copy_op({"id": "copy-custom-note", "type": "update", "activityId": "space-city", "patch": {"note": "Tickets booked by Mia"}, "base": {"note": old_by_id["space-city"]["note"]}})
copy_op({"id": "copy-custom-both", "type": "update", "activityId": "machines", "patch": {"title": "Our own mechanical museum plan", "note": "Personal note"}, "base": {"title": old_by_id["machines"]["title"], "note": old_by_id["machines"]["note"]}})
copy_op({"id": "copy-delete-default", "type": "delete", "activityId": "dinner-market", "expectedRevision": 1})
copy_op({"id": "copy-new-activity", "type": "create", "activity": activity("custom-trip-stop")})
copy_op({"id": "copy-participation", "type": "participate", "activityId": "arrival", "memberId": "mia", "status": "going"})
copy_op({"id": "copy-reaction", "type": "react", "activityId": "arrival", "memberId": "james", "emoji": "👍", "active": True})
copy_before = copy_state()
ledger_before = sql("select count(*) from travel_private.trip_operations;", database=copy_database).stdout
migration_004 = Path("supabase/migrations/202610300004_default_activity_copy.sql").read_text()
sql(migration_004, database=copy_database)
copy_after = copy_state()
after_by_id = {a["id"]: a for a in copy_after["activities"]}
copy_updates = {a["id"]: a for a in json.load(open("docs/seed-copy-updates.json"))}
assert_pass(after_by_id["arrival"]["title"] == "Our arrival plan" and after_by_id["arrival"]["note"] == copy_updates["arrival"]["note"]["new"], "copy migration preserves user title while refreshing untouched note")
assert_pass(after_by_id["space-city"]["note"] == "Tickets booked by Mia" and after_by_id["space-city"]["title"] == copy_updates["space-city"]["title"]["new"], "copy migration preserves user note while refreshing untouched title")
assert_pass(after_by_id["machines"] == next(a for a in copy_before["activities"] if a["id"] == "machines"), "copy migration leaves a fully edited activity and its revision unchanged")
assert_pass("dinner-market" not in after_by_id, "copy migration does not restore a deleted default activity")
assert_pass(after_by_id["custom-trip-stop"] == next(a for a in copy_before["activities"] if a["id"] == "custom-trip-stop"), "copy migration preserves newly created activities")
assert_pass(copy_after["responses"] == copy_before["responses"] and copy_after["reactions"] == copy_before["reactions"], "copy migration preserves every participation and reaction")
assert_pass([a["id"] for a in copy_after["activities"]] == [a["id"] for a in copy_before["activities"]], "copy migration preserves activity order and ids")
assert_pass(copy_after["version"] == copy_before["version"] + 1, "copy migration increments the board version exactly once")
expected_copy = json.loads(json.dumps(copy_before))
changed_activities = 0
for item in expected_copy["activities"]:
    change = copy_updates.get(item["id"], {})
    changed = False
    for field in ("title", "note"):
        if field in change and item[field] == change[field]["old"] and item[field] != change[field]["new"]:
            item[field] = change[field]["new"]
            changed = True
    if changed:
        item["revision"] += 1
        changed_activities += 1
expected_copy["version"] += bool(changed_activities)
assert_pass(copy_after == expected_copy, "copy migration changes only matching default fields and each changed revision once")
assert_pass(sql("select count(*) from travel_private.trip_operations;", database=copy_database).stdout == ledger_before, "copy migration preserves operation history")
sql(migration_004, database=copy_database)
assert_pass(copy_state() == copy_after, "copy migration rerun is fully idempotent including all versions")
