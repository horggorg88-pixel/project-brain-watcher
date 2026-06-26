import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  enrollManagedDevice,
  ensureManagedDeviceEnrolled,
  readManagedDeviceStatus,
} from "../../apps/watcher-desktop/src/desktop-support-device.js";
import { runSupportAgentOnce } from "../../apps/watcher-desktop/src/desktop-support-agent.js";
import type { DesktopAccountAuthorization } from "../../apps/watcher-desktop/src/desktop-account-auth.js";
import { saveProfile } from "../../apps/watcher-desktop/src/desktop-profile-store.js";
import { stageDesktopServiceSecret } from "../../apps/watcher-desktop/src/desktop-service-secret.js";

const tempDirs: string[] = [];
const ACCOUNT_BEARER = "pb_account_bearer_12345678901234567890";
const DEVICE_TOKEN = "pbs_device_token_12345678901234567890";

afterEach(() => {
  for (const dir of tempDirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe("watcher desktop support device", () => {
  it("enrolls a managed device without writing the account bearer into state JSON", async () => {
    const paths = tempPaths();
    let enrollmentBody: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        enrollmentBody = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        return new Response(
          JSON.stringify({
            ok: true,
            device: {
              deviceId: "dev_test",
              meshUrl: "https://mesh.example.test/device/dev_test",
            },
            deviceToken: "pbs_device_token",
          }),
          { status: 200 },
        );
      }),
    );

    const result = await enrollManagedDevice(paths, account(), "mcp-project");
    const status = readManagedDeviceStatus(paths);
    const statePath = join(paths.userDataPath, "desktop-support-device.json");
    const state = existsSync(statePath) ? readFileSync(statePath, "utf-8") : "";

    expect(result.enrolled).toBe(true);
    expect(status.deviceId).toBe("dev_test");
    expect(enrollmentBody.projectId).toBe("mcp-project");
    expect(enrollmentBody.label).toBe(
      "mcp-project · " + enrollmentBody.hostname,
    );
    expect(state).toContain("pbs_device_token");
    expect(state).not.toContain("pb_account_bearer");
  });

  it("claims and completes diagnostics jobs with the managed device token", async () => {
    const paths = tempPaths();
    const requests: string[] = [];
    let completeBody: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        requests.push(`${init?.method ?? "GET"} ${urlOf(input)}`);
        if (urlOf(input).endsWith("/api/support/devices/enroll")) {
          return jsonResponse({
            ok: true,
            device: { deviceId: "dev_test", meshUrl: null },
            deviceToken: "pbs_device_token",
          });
        }
        if (urlOf(input).endsWith("/api/support/devices/heartbeat")) {
          return jsonResponse({ ok: true, device: { deviceId: "dev_test" } });
        }
        if (urlOf(input).endsWith("/api/support/jobs/claim")) {
          return jsonResponse({
            ok: true,
            job: {
              jobId: "job_test",
              action: "collect_diagnostics",
              payload: { projectId: "mcp-project" },
            },
          });
        }
        if (urlOf(input).endsWith("/api/support/jobs/job_test/progress")) {
          return jsonResponse({
            ok: true,
            job: { jobId: "job_test", status: "running" },
          });
        }
        if (urlOf(input).endsWith("/api/support/jobs/job_test/complete")) {
          completeBody = JSON.parse(String(init?.body ?? "{}")) as Record<
            string,
            unknown
          >;
          return jsonResponse({
            ok: true,
            job: { jobId: "job_test", status: "succeeded" },
          });
        }
        return jsonResponse({ ok: false, error: "unexpected request" }, 404);
      }),
    );

    await enrollManagedDevice(paths, account(), "mcp-project");
    const result = await runSupportAgentOnce(paths, "mcp-project");

    expect(result.status).toBe("completed");
    expect(result.jobId).toBe("job_test");
    expect(requests).toEqual([
      "POST http://console.example.test/api/support/devices/enroll",
      "POST http://console.example.test/api/support/devices/heartbeat",
      "POST http://console.example.test/api/support/jobs/claim",
      "POST http://console.example.test/api/support/jobs/job_test/progress",
      "POST http://console.example.test/api/support/jobs/job_test/progress",
      "POST http://console.example.test/api/support/jobs/job_test/progress",
      "POST http://console.example.test/api/support/jobs/job_test/complete",
    ]);
    const completedResult = completeBody?.result as Record<string, unknown>;
    const receipt = completedResult.receipt as Record<string, unknown>;
    const receiptLedger = completedResult.receiptLedger as Record<string, unknown>;
    expect(completeBody?.status).toBe("succeeded");
    expect(receipt.commandId).toBe("support.collect_diagnostics");
    expect(receipt.status).toBe("passed");
    expect(receipt.ackState).toBe("server_pending");
    expect(receipt.receiptId).toMatch(/^dcr_[a-f0-9]{20}$/);
    expect(receiptLedger.saved).toBe(true);
  });

  it("posts progress events while executing claimed support jobs", async () => {
    const paths = tempPaths();
    const progressBodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        if (urlOf(input).endsWith("/api/support/devices/enroll")) {
          return jsonResponse({
            ok: true,
            device: { deviceId: "dev_progress", meshUrl: null },
            deviceToken: "pbs_device_token",
          });
        }
        if (urlOf(input).endsWith("/api/support/devices/heartbeat")) {
          return jsonResponse({
            ok: true,
            device: { deviceId: "dev_progress" },
          });
        }
        if (urlOf(input).endsWith("/api/support/jobs/claim")) {
          return jsonResponse({
            ok: true,
            job: {
              jobId: "job_progress",
              action: "collect_diagnostics",
              payload: { projectId: "mcp-project" },
            },
          });
        }
        if (urlOf(input).endsWith("/api/support/jobs/job_progress/progress")) {
          progressBodies.push(
            JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
          );
          return jsonResponse({
            ok: true,
            job: { jobId: "job_progress", status: "running" },
          });
        }
        if (urlOf(input).endsWith("/api/support/jobs/job_progress/complete")) {
          return jsonResponse({
            ok: true,
            job: { jobId: "job_progress", status: "succeeded" },
          });
        }
        return jsonResponse({ ok: false, error: "unexpected request" }, 404);
      }),
    );

    await enrollManagedDevice(paths, account(), "mcp-project");
    const result = await runSupportAgentOnce(paths, "mcp-project");

    expect(result.status).toBe("completed");
    expect(progressBodies.map((body) => body.stage)).toContain(
      "collect_diagnostics",
    );
    expect(progressBodies.some((body) => body.progressPercent === 20)).toBe(
      true,
    );
    expect(JSON.stringify(progressBodies)).not.toContain(DEVICE_TOKEN);
  });

  it("auto-enrolls from the saved project service secret before heartbeat", async () => {
    const paths = tempPaths();
    const projectRoot = join(paths.homePath, "mcp-project");
    mkdirSync(projectRoot, { recursive: true });
    const profile = saveProfile(paths, {
      id: "mcp-project",
      name: "MCP Project",
      root: projectRoot,
      indexId: "idx-mcp-project",
      serverUrl: "http://149.33.14.250",
      consoleUrl: "http://console.example.test",
      tokenEnv: "MCP_BEARER_TOKEN",
    });
    stageDesktopServiceSecret(profile, ACCOUNT_BEARER);
    const requests: string[] = [];
    const authorizations: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        requests.push(`${init?.method ?? "GET"} ${urlOf(input)}`);
        authorizations.push(authorizationOf(init));
        if (urlOf(input).endsWith("/api/support/devices/enroll")) {
          return jsonResponse({
            ok: true,
            device: { deviceId: "dev_saved", meshUrl: null },
            deviceToken: DEVICE_TOKEN,
          });
        }
        if (urlOf(input).endsWith("/api/support/devices/heartbeat")) {
          return jsonResponse({ ok: true, device: { deviceId: "dev_saved" } });
        }
        if (urlOf(input).endsWith("/api/support/jobs/claim")) {
          return jsonResponse({ ok: true, job: null });
        }
        return jsonResponse({ ok: false, error: "unexpected request" }, 404);
      }),
    );

    const enrollment = await ensureManagedDeviceEnrolled(paths, "mcp-project");
    const result = await runSupportAgentOnce(paths, "mcp-project");

    expect(enrollment.enrolled).toBe(true);
    expect(result.enrolled).toBe(true);
    expect(result.status).toBe("idle");
    expect(requests).toEqual([
      "POST http://console.example.test/api/support/devices/enroll",
      "POST http://console.example.test/api/support/devices/heartbeat",
      "POST http://console.example.test/api/support/jobs/claim",
    ]);
    expect(authorizations).toEqual([
      `Bearer ${ACCOUNT_BEARER}`,
      `Bearer ${DEVICE_TOKEN}`,
      `Bearer ${DEVICE_TOKEN}`,
    ]);
  });

  it("re-enrolls when an old support state points to a local bind URL", async () => {
    const paths = tempPaths();
    const projectRoot = join(paths.homePath, "mcp-project");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(paths.userDataPath, { recursive: true });
    const profile = saveProfile(paths, {
      id: "mcp-project",
      name: "MCP Project",
      root: projectRoot,
      indexId: "idx-mcp-project",
      serverUrl: "http://149.33.14.250",
      consoleUrl: "http://0.0.0.0:3020",
      tokenEnv: "MCP_BEARER_TOKEN",
    });
    stageDesktopServiceSecret(profile, ACCOUNT_BEARER);
    writeFileSync(
      join(paths.userDataPath, "desktop-support-device.json"),
      JSON.stringify({
        deviceId: "dev_stale",
        deviceToken: "pbs_stale_device_token",
        supportBaseUrl: "http://0.0.0.0:3020",
        meshUrl: null,
        updatedAt: new Date(0).toISOString(),
      }),
      "utf-8",
    );
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Parameters<typeof fetch>[0]) => {
        requests.push(urlOf(input));
        if (urlOf(input).endsWith("/api/support/devices/enroll")) {
          return jsonResponse({
            ok: true,
            device: { deviceId: "dev_repaired", meshUrl: null },
            deviceToken: DEVICE_TOKEN,
          });
        }
        return jsonResponse({ ok: false, error: "unexpected request" }, 404);
      }),
    );

    const before = readManagedDeviceStatus(paths);
    const enrollment = await ensureManagedDeviceEnrolled(paths, "mcp-project");
    const after = readManagedDeviceStatus(paths);

    expect(before.enrolled).toBe(false);
    expect(enrollment.enrolled).toBe(true);
    expect(after.deviceId).toBe("dev_repaired");
    expect(requests).toEqual([
      "http://149.33.14.250:3020/api/support/devices/enroll",
    ]);
  });

  it("re-enrolls an existing support state when it is missing the selected project id", async () => {
    const paths = tempPaths();
    const projectRoot = join(paths.homePath, "mcp-project");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(paths.userDataPath, { recursive: true });
    const profile = saveProfile(paths, {
      id: "mcp-project",
      name: "MCP Project",
      root: projectRoot,
      indexId: "idx-mcp-project",
      serverUrl: "http://149.33.14.250",
      consoleUrl: "http://console.example.test",
      tokenEnv: "MCP_BEARER_TOKEN",
    });
    stageDesktopServiceSecret(profile, ACCOUNT_BEARER);
    writeFileSync(
      join(paths.userDataPath, "desktop-support-device.json"),
      JSON.stringify({
        deviceId: "dev_existing",
        deviceToken: "pbs_existing_device_token",
        supportBaseUrl: "http://console.example.test",
        meshUrl: null,
        updatedAt: new Date(0).toISOString(),
      }),
      "utf-8",
    );
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        bodies.push(
          JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
        );
        if (urlOf(input).endsWith("/api/support/devices/enroll")) {
          return jsonResponse({
            ok: true,
            device: { deviceId: "dev_project_bound", meshUrl: null },
            deviceToken: DEVICE_TOKEN,
          });
        }
        return jsonResponse({ ok: false, error: "unexpected request" }, 404);
      }),
    );

    const before = readManagedDeviceStatus(paths);
    const enrollment = await ensureManagedDeviceEnrolled(paths, "mcp-project");
    const after = readManagedDeviceStatus(paths);
    const state = JSON.parse(
      readFileSync(
        join(paths.userDataPath, "desktop-support-device.json"),
        "utf-8",
      ),
    ) as Record<string, unknown>;

    expect(before.enrolled).toBe(true);
    expect(enrollment.enrolled).toBe(true);
    expect(after.deviceId).toBe("dev_project_bound");
    expect(bodies).toHaveLength(1);
    expect(bodies[0].projectId).toBe("mcp-project");
    expect(state.projectId).toBe("mcp-project");
  });
});

function tempPaths() {
  const root = mkdtempSync(join(tmpdir(), "watcher-desktop-support-"));
  tempDirs.push(root);
  return {
    homePath: join(root, "home"),
    userDataPath: join(root, "user-data"),
  };
}

function account(): DesktopAccountAuthorization {
  return {
    ok: true,
    serverUrl: "http://149.33.14.250",
    consoleUrl: "http://console.example.test",
    supportBaseUrl: "http://console.example.test",
    meshBaseUrl: "https://mesh.example.test",
    bearerToken: ACCOUNT_BEARER,
    tokenEnv: "MCP_BEARER_TOKEN",
    message: "ok",
  };
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function authorizationOf(init?: RequestInit): string {
  const headers = init?.headers;
  if (!headers) return "";
  if (headers instanceof Headers)
    return headers.get("authorization") ?? headers.get("Authorization") ?? "";
  if (Array.isArray(headers)) {
    const entry = headers.find(
      ([key]) => key.toLowerCase() === "authorization",
    );
    return typeof entry?.[1] === "string" ? entry[1] : "";
  }
  const record = headers as Record<string, string>;
  return record.authorization ?? record.Authorization ?? "";
}
