import { describe, expect, it } from "vitest";
import {
  type UowMap,
  buildFieldTypeMap,
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
  public bool Save(int id) {
    MyQuery qr = new MyQuery("FOO_SAVE_BYID", CommandType.StoredProcedure);
    return DBConnect.ExecuteTrans(qr);
  }
  public bool Save(string code) {
    MyQuery qr = new MyQuery("FOO_SAVE_BYCODE", CommandType.StoredProcedure);
    return DBConnect.ExecuteTrans(qr);
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

  it("KHÔNG fallback: không rõ method nào → 0 proc (tránh dương tính giả .Location)", () => {
    expect(collectScopedProcs(REPO, undefined).size).toBe(0);
    expect(collectScopedProcs(REPO, new Set()).size).toBe(0);
  });

  it("gộp MỌI overload cùng tên (mỗi overload 1 proc)", () => {
    const procs = collectScopedProcs(REPO, new Set(["Save"]));
    expect([...procs].sort()).toEqual(["FOO_SAVE_BYCODE", "FOO_SAVE_BYID"]);
  });
});

describe("collectDirectProcs", () => {
  it("lấy mọi MyQuery trực tiếp (form/control)", () => {
    expect([...collectDirectProcs(FORM)]).toEqual(["FORM_DIRECT"]);
  });
});

describe("buildFieldTypeMap + field-call (uỷ quyền BOL→DAL)", () => {
  const BOL = `
public class TR_FOO_BOL {
  TR_FOO_DAL _dal;
  public TR_FOO_BOL() { _dal = new TR_FOO_DAL(); }
  public DataTable GetTableBySP(string masp) {
    return _dal.GetTableBySP(masp);
  }
}`;

  it("map field → repo class từ '<field> = new <Class>('", () => {
    const fields = buildFieldTypeMap(BOL);
    expect(fields.get("_dal")).toBe("tr_foo_dal");
  });

  it("bắt lời gọi field-call '_dal.Method(' khi có fieldTypes", () => {
    const fields = buildFieldTypeMap(BOL);
    const calls = extractCallsInMethods(BOL, ["GetTableBySP"], uow, fields);
    expect(calls).toContainEqual({ cls: "tr_foo_dal", method: "GetTableBySP" });
  });

  it("KHÔNG bắt field-call khi thiếu fieldTypes (tránh nhiễu mọi .Method()", () => {
    const calls = extractRepoMethodCalls("var x = a.B(1); y.C(2);", uow);
    expect(calls.length).toBe(0);
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
