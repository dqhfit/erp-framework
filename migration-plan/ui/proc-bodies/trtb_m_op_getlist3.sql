-- PARAMS:
-- (khong co tham so)


CREATE PROC [dbo].[TRTB_M_OP_GETLIST3]
AS
BEGIN
	SELECT A.*, B.tenkhuvuc
	FROM trtb_m_op A
		INNER JOIN tr_khuvuc_sanxuat B ON A.department = B.makhuvuc
	WHERE A.active = 1
	ORDER BY A.stt
END

