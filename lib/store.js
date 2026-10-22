"use strict";
const { random, sha } = require("./security");
const { RETENTION_MS, seedWorkspace, ValidationError } = require("./domain");
class Store {
  constructor(
    collection,
    { now = () => new Date(), maxWorkspaces = 100 } = {},
  ) {
    this.collection = collection;
    this.now = now;
    this.maxWorkspaces = maxWorkspaces;
  }
  active() {
    return { isDemo: false, expiresAt: { $gt: this.now() } };
  }
  async prepare({ indexes = true } = {}) {
    if (indexes) {
      await this.collection.createIndex({ kind: 1, expiresAt: 1 });
      await this.collection.createIndex({
        kind: 1,
        workspaceId: 1,
        generation: 1,
      });
      await this.collection.createIndex({ isDemo: 1, expiresAt: 1 });
    }
    await this.collection.updateOne(
      { _id: "seed:salon:v1" },
      {
        $setOnInsert: {
          kind: "seed",
          isDemo: true,
          version: 1,
          services: require("./domain").SERVICES,
          description:
            "Immutable fictional source template. Workspace copies expire.",
        },
      },
      { upsert: true },
    );
  }
  async createWorkspace() {
    const now = this.now();
    const start = require("node:crypto").randomInt(this.maxWorkspaces);
    for (let i = 0; i < this.maxWorkspaces; i++) {
      const id = `workspace:${(start + i) % this.maxWorkspaces}`;
      const doc = {
        kind: "workspace",
        isDemo: false,
        createdAt: now,
        expiresAt: new Date(+now + RETENTION_MS),
        generation: random(),
        version: 0,
        ...seedWorkspace(now),
      };
      try {
        const result = await this.collection.findOneAndUpdate(
          {
            _id: id,
            $or: [
              { expiresAt: { $lte: now } },
              { expiresAt: { $exists: false } },
            ],
          },
          { $set: doc, $unset: { username: "", passwordHash: "" } },
          { upsert: true, returnDocument: "after" },
        );
        if (result) return result;
      } catch (err) {
        if (err.code !== 11000) throw err;
      }
    }
    throw new ValidationError(
      "The demo is at capacity. Please come back after an older workspace expires.",
      429,
    );
  }
  async workspace(id, generation) {
    return this.collection.findOne({
      _id: id,
      kind: "workspace",
      generation,
      ...this.active(),
    });
  }
  async mutate(workspace, fn) {
    for (let n = 0; n < 5; n++) {
      const current = await this.workspace(workspace._id, workspace.generation);
      if (!current)
        throw new ValidationError(
          "Your workspace expired. Start a new demo.",
          401,
        );
      const data = structuredClone(current);
      fn(data);
      if (Buffer.byteLength(JSON.stringify(data)) > 220000)
        throw new ValidationError(
          "This workspace reached its demo storage limit.",
          429,
        );
      const result = await this.collection.replaceOne(
        {
          _id: current._id,
          generation: current.generation,
          version: current.version,
          ...this.active(),
        },
        { ...data, version: current.version + 1 },
      );
      if (result.modifiedCount)
        return { ...data, version: current.version + 1 };
    }
    throw new ValidationError(
      "Another change arrived at the same time. Please try again.",
      409,
    );
  }
  async createSession(workspace) {
    const now = this.now();
    const token = random();
    const doc = {
      _id: "session:" + sha(token),
      kind: "session",
      isDemo: false,
      workspaceId: workspace._id,
      generation: workspace.generation,
      createdAt: now,
      expiresAt: new Date(Math.min(+now + 8 * 3600000, +workspace.expiresAt)),
    };
    await this.collection.deleteMany({
      kind: "session",
      workspaceId: workspace._id,
      generation: workspace.generation,
    });
    await this.collection.insertOne(doc);
    return token;
  }
  async session(token) {
    if (!/^[a-f0-9]{64}$/.test(token || "")) return null;
    return this.collection.findOne({
      _id: "session:" + sha(token),
      kind: "session",
      ...this.active(),
    });
  }
  async logout(token) {
    if (token)
      await this.collection.deleteOne({
        _id: "session:" + sha(token),
        kind: "session",
      });
  }
  async throttle(key, limit, windowMs) {
    const now = this.now();
    const start = Math.floor(+now / windowMs) * windowMs;
    const id = "rate:" + sha(key + ":" + start);
    const row = await this.collection.findOneAndUpdate(
      { _id: id },
      {
        $inc: { count: 1 },
        $setOnInsert: {
          kind: "rate",
          isDemo: false,
          createdAt: now,
          expiresAt: new Date(start + windowMs),
        },
      },
      { upsert: true, returnDocument: "after" },
    );
    if (row.count > limit)
      throw new ValidationError(
        "Too many attempts. Please try again later.",
        429,
      );
  }
  async claimUsername(workspace, name) {
    const id = "username:" + sha(name);
    try {
      await this.collection.insertOne({
        _id: id,
        kind: "username",
        isDemo: false,
        name,
        workspaceId: workspace._id,
        generation: workspace.generation,
        createdAt: this.now(),
        expiresAt: workspace.expiresAt,
      });
    } catch (err) {
      if (err.code === 11000)
        throw new ValidationError("That workspace name is already in use.");
      throw err;
    }
  }
  async findUsername(name) {
    const record = await this.collection.findOne({
      _id: "username:" + sha(name),
      kind: "username",
      ...this.active(),
    });
    return record
      ? this.workspace(record.workspaceId, record.generation)
      : null;
  }
  async cleanup() {
    const result = await this.collection.deleteMany({
      isDemo: false,
      expiresAt: { $lte: this.now() },
    });
    return { deleted: result.deletedCount };
  }
}
module.exports = { Store };
