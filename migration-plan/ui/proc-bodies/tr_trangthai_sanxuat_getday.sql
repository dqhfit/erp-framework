-- PARAMS:
-- @tungay date
-- @denngay date


CREATE PROC [dbo].[TR_TRANGTHAI_SANXUAT_GETDAY](@tungay date, @denngay date)
AS
SELECT A.*,(A.dai*A.rong*A.soluong * ISNULL(case when A.somatuv = 0 then 1 else A.somatuv end ,1))/1000000 as m2
FROM tr_trangthai_sanxuat A
WHERE ngaythang between @tungay and @denngay 
	AND ViTriMay IS NULL AND congdoan = 'UVP'
