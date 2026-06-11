-- PARAMS:
-- (khong co tham so)

CREATE PROC [dbo].[TR_TONKHO_SUM_GETALL2]
AS

	SELECT A.*, B.mota, B.quycach, B.dvt
	FROM tr_tonkho_sum A
		INNER JOIN tr_material B ON A.mavt = B.mavt
	WHERE B.xoa = 'N'
