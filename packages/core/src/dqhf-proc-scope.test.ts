import { describe, expect, it } from "vitest";
import {
  type UowMap,
  collectDirectProcs,
  collectScopedProcs,
  extractCallsInMethods,
  extractRepoMethodCalls,
  lastTypeSegment,
} from "./dqhf-proc-scope";

// Repo dùng chung: 3 method, mỗi method 1 proc. Form chỉ gọi GetAll + Insert.
const REPO = `
public class TR_FOO {
  public DataTable GetAll(string masp) {
    MyQuery qr = new MyQuery("FOO_GETALL", CommandType.StoredProcedure);
    return DBConnect.getTable(qr);
  }
  public bool Insert(FOO m) {
    MyQuery qr = new MyQuery("FOO_INSERT", CommandType.StoredProcedure);
    return DBConnect.ExecuteTrans(qr);
  }
  public DataTable Search3(string kw) {
    MyQuery qr = new MyQuery("FOO_SEARCH3", CommandType.StoredProcedure);
    return DBConnect.getTable(qr);
  }
}`;

const FORM = `
public partial class frmFoo : Form {
  void Load() {
    var dt = UnitOfWork.FOO.GetAll(masp);
    new TR_FOO().Insert(model);
    MyQuery direct = new MyQuery("FORM_DIRECT", CommandType.StoredProcedure);
  }
}`;

const uow: UowMap = new Map([["foo", "CommonClass.BOL.TR_FOO"]]);

describe("lastTypeSegment", () => {
  it("lấy segment cuối của type qualified", () => {
    expect(lastTypeSegment("CommonClass.BOL.TR_FOO")).toBe("TR_FOO");
    expect(lastTypeSegment("TR_FOO")).toBe("TR_FOO");
  });
});

describe("extractRepoMethodCalls", () => {
  it("bắt cả gọi qua UnitOfWork.Prop và new Class()", () => {
    const calls = extractRepoMethodCalls(FORM, uow);
    expect(calls).toContainEqual({ cls: "tr_foo", method: "GetAll" });
    expect(calls).toContainEqual({ cls: "tr_foo", method: "Insert" });
  });
});

describe("collectScopedProcs", () => {
  it("CHỈ gom proc của method được gọi (không hốt cả repo)", () => {
    const procs = collectScopedProcs(REPO, new Set(["GetAll", "Insert"]));
    expect([...procs].sort()).toEqual(["FOO_GETALL", "FOO_INSERT"]);
    // Search3 KHÔNG được gọi → proc của nó không lọt.
    expect(procs.has("FOO_SEARCH3")).toBe(false);
  });

  it("fallback: không rõ method nào → lấy mọi MyQuery (giữ hành vi cũ)", () => {
    const procs = collectScopedProcs(REPO, undefined);
    expect([...procs].sort()).toEqual(["FOO_GETALL", "FOO_INSERT", "FOO_SEARCH3"]);
  });
});

describe("collectDirectProcs", () => {
  it("lấy mọi MyQuery trực tiếp (form/control)", () => {
    expect([...collectDirectProcs(FORM)]).toEqual(["FORM_DIRECT"]);
  });
});

describe("extractCallsInMethods (lan truyền repo→repo)", () => {
  it("chỉ trích lời gọi lồng trong thân method chỉ định", () => {
    const repoChain = `
public class TR_BAR {
  public void DoIt() {
    var x = UnitOfWork.FOO.GetAll(1);
  }
  public void Unused() {
    var y = UnitOfWork.FOO.Search3(2);
  }
}`;
    const calls = extractCallsInMethods(repoChain, ["DoIt"], uow);
    expect(calls).toContainEqual({ cls: "tr_foo", method: "GetAll" });
    // Unused() không nằm trong tập gọi → Search3 không lan ra.
    expect(calls.some((c) => c.method === "Search3")).toBe(false);
  });
});
