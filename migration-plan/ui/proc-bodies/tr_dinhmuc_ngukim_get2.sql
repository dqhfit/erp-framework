-- PARAMS:
-- @masp nvarchar

CREATE PROC [dbo].[TR_DINHMUC_NGUKIM_Get2] (@masp NVARCHAR (MAX))
AS
SELECT a.id,
       a.pcode,
       a.ccode,
       a.c_level,
       a.masp,
       a.mavt,
       a.stt,
       a.chitiet,
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
       B.mota,
       B.tenvt,
       B.quycach,
       B.dvt,
       B.mausac,
       b.heren,
       b.hinhanh1
FROM tr_dinhmuc_ngukim a INNER JOIN tr_material b ON A.mavt = B.mavt
WHERE a.masp = @masp
ORDER BY a.stt
