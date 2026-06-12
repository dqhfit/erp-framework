-- PARAMS:
-- @makhuvuc nvarchar

CREATE   PROCEDURE [dbo].[TRTB_M_LOCATION_GETBYDEPARTMENT](@makhuvuc nvarchar(50))
AS
BEGIN
    SELECT C.*, B.n_op, A.tenkhuvuc,
		CASE REPLACE(C.c_location, LEFT(C.c_location, CHARINDEX('-', C.c_location)), '') 
			WHEN 'PROD' THEN N'Hoàn thành'
			WHEN 'IN' THEN N'Nhận'
			WHEN 'OUT' THEN N'Giao'
			ELSE ''
		END AS location_type
   FROM tr_khuvuc_sanxuat A
        INNER JOIN trtb_m_op B ON A.makhuvuc = B.department
        INNER JOIN trtb_m_location C ON B.c_op = C.c_op
    WHERE A.active = 1 AND B.active = 1 AND C.active = 1
        AND CASE WHEN @makhuvuc = 'ALL' THEN @makhuvuc ELSE A.makhuvuc END = @makhuvuc
    ORDER BY A.stt, B.stt, C.stt

END



