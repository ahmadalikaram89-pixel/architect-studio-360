import { describe, it, expect } from "vitest";
import { computeMembership } from "../collaboration";

const PROJECT = { id: "p1", user_id: "owner-1" };

describe("computeMembership", () => {
  it("returns null role when project or userId missing", () => {
    expect(computeMembership(null, [], "u1")).toEqual({ role: null, isOwner: false, canEdit: false });
    expect(computeMembership(PROJECT, [], null)).toEqual({ role: null, isOwner: false, canEdit: false });
  });

  it("recognizes the project owner regardless of members list", () => {
    expect(computeMembership(PROJECT, [], "owner-1")).toEqual({ role: "owner", isOwner: true, canEdit: true });
  });

  it("recognizes an editor member", () => {
    const members = [{ user_id: "editor-1", role: "editor" }];
    expect(computeMembership(PROJECT, members, "editor-1")).toEqual({ role: "editor", isOwner: false, canEdit: true });
  });

  it("recognizes a viewer member as read-only", () => {
    const members = [{ user_id: "viewer-1", role: "viewer" }];
    expect(computeMembership(PROJECT, members, "viewer-1")).toEqual({ role: "viewer", isOwner: false, canEdit: false });
  });

  it("returns null role for a user with no membership row", () => {
    const members = [{ user_id: "editor-1", role: "editor" }];
    expect(computeMembership(PROJECT, members, "stranger-1")).toEqual({ role: null, isOwner: false, canEdit: false });
  });

  it("ignores pending (unclaimed) invites with user_id null", () => {
    const members = [{ user_id: null, invited_email: "x@test.local", role: "editor" }];
    expect(computeMembership(PROJECT, members, "x-1")).toEqual({ role: null, isOwner: false, canEdit: false });
  });
});
