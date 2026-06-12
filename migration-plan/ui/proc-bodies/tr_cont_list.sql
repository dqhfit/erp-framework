-- PARAMS:
-- (khong co tham so)

CREATE PROC TR_CONT_List
AS
SELECT cont_id, cont_number, seal_number, order_number
	, ngaytao, nguoitao 
FROM tr_cont
WHERE trangthai = 1
	AND ISNULL(ngayxuat, '') = ''
ORDER by ngaytao DESC
