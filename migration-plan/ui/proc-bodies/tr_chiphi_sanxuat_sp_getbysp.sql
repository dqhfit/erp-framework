-- PARAMS:
-- @masp nvarchar


CREATE PROC [dbo].[TR_CHIPHI_SANXUAT_SP_GETBYSP](@masp nvarchar(200))
AS
BEGIN
	SELECT * 
	INTO #chiphi_sanxuat_sp
	FROM tr_chiphi_sanxuat_sp
	WHERE masp = @masp


	SELECT A.id, A.masp, 
		ISNULL(A.hangmuc_id, B.id) AS hangmuc_id, 
		A.chitiet, A.chiphi1, A.chiphi2, A.phantram, 
		B.hangmuc, B.p_id, B.ghichu
	FROM #chiphi_sanxuat_sp A
		RIGHT JOIN tr_hangmuc_chiphi B ON A.hangmuc_id = B.id
	ORDER BY B.stt

	DROP TABLE #chiphi_sanxuat_sp;
END



