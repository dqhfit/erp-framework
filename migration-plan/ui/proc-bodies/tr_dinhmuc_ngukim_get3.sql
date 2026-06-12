-- PARAMS:
-- @masp nvarchar
-- @HWforWW bit

CREATE PROC [dbo].[TR_DINHMUC_NGUKIM_Get3] (@masp      NVARCHAR (MAX),
                                           @HWforWW   BIT)
AS
SELECT a.id,
       a.pcode,
       a.ccode,
       a.c_level,
       a.masp,
       a.mavt,
       a.stt,
       a.slchet,
       a.slroi,
       a.soluong,
       a.nhom,
       a.HWforWW,
       a.HWforPacking,
       a.HWforAI,
       a.bophan_sudung,
       a.tenbophan,
       a.vitri_sudung,
       a.ghichu,
       a.hoanthanh,
       a.ngaytao,
       a.nguoitao,
       a.ngaysua,
       a.nguoisua,
       a.maspid,
       a.maspmasp,
       B.mota AS chitiet,
       B.tenvt AS tenvt,
       B.quycach,
       B.dvt,
       B.mausac
FROM tr_dinhmuc_ngukim a LEFT JOIN tr_material b ON A.mavt = B.mavt
WHERE a.masp = @masp AND A.HWforWW = @HWforWW
