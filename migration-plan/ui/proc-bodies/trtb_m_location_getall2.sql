-- PARAMS:
-- (khong co tham so)


CREATE PROC TRTB_M_LOCATION_GETALL2
AS
BEGIN
	
	SELECT A.makhuvuc, A.tenkhuvuc, B.c_op, B.n_op, C.c_location,
		n_location = CASE SUBSTRING(C.c_location, CHARINDEX('-', C.c_location) + 1, LEN(C.c_location)) 
							WHEN 'IN' THEN N'Nhận'
							WHEN 'PROD' THEN N'Hoàn thành'
						END,
		A.stt, B.stt as stt1
	FROM tr_khuvuc_sanxuat A
	INNER JOIN trtb_m_op B ON A.makhuvuc = B.department
	INNER JOIN trtb_m_location C ON B.c_op = C.c_op
	WHERE A.active = 1 AND B.active = 1 AND A.active = 1
		AND C.isShow = 1
	ORDER BY A.stt, B.stt
END

