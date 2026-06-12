-- PARAMS:
-- @type nvarchar


CREATE PROC [dbo].[TRTB_M_LOCATION_GETLIST3](@type nvarchar(10))
AS
BEGIN
	IF @type = 'PROD'
	BEGIN
		SELECT A.c_op, 
		A.n_op, 
		CASE 
			WHEN A.c_op = 'DP09' THEN N'Phôi 2'
			WHEN A.c_op = 'PHOI1' THEN N'Phôi 1'
			WHEN A.c_op = 'DH06' THEN N'Định hình 1'
			WHEN A.c_op = 'DH07' THEN N'Định hình 2'
			WHEN A.c_op = 'NHA01' THEN N'Nguội'
			WHEN A.c_op = 'LR02' THEN N'Lắp ráp'
			WHEN A.c_op = 'DBDH' THEN N'Đồng bộ định hình'
			ELSE A.n_op
		END AS tenthaythe, 
		B.c_location, B.n_location
		FROM trtb_m_op A
			INNER JOIN trtb_m_location B ON A.c_op = B.c_op
		WHERE B.c_location IN ('DP09-PROD', 'DH07-PROD', 'LR02-PROD', 'NHA01-PROD', 'PHOI1-PROD', 'DBDH-PROD')
		ORDER BY CASE
					WHEN A.c_op = 'PHOI1' THEN 1
					WHEN A.c_op = 'DP09' THEN 2
					WHEN A.c_op = 'DH06' THEN 3
					WHEN A.c_op = 'DH07' THEN 4
					WHEN A.c_op = 'LR02' THEN 5
					WHEN A.c_op = 'NHA01' THEN 6
					WHEN A.c_op = 'NHA01' THEN 6
					WHEN A.c_op = 'DBDH' THEN 7
				END
	END
	ELSE IF @type = 'IN'
	BEGIN
		SELECT A.c_op, 
		A.n_op, 
		CASE 
			WHEN A.c_op = 'DP09' THEN N'Phôi 2'
			WHEN A.c_op = 'DH06' THEN N'Định hình 1'
			WHEN A.c_op = 'DH07' THEN N'Định hình 2'
			WHEN A.c_op = 'LR02' THEN N'Lắp ráp'
			WHEN A.c_op = 'NHA01' THEN N'Nguội'
			WHEN A.c_op = 'SCT01' THEN N'Sơn băng tải'
			WHEN A.c_op = 'UV03' THEN N'Chuyền UV'
			ELSE A.n_op
		END AS tenthaythe, 
		B.c_location, B.n_location
		FROM trtb_m_op A
			INNER JOIN trtb_m_location B ON A.c_op = B.c_op
		WHERE B.c_location IN ('DP09-IN', 'DH07-IN', 'LR02-IN', 'NHA01-IN', 'SCT01-IN', 'UV03-IN', 'PHOI1-IN', 'DBDH-IN')
		ORDER BY CASE
					WHEN A.c_op = 'PHOI1' THEN 1
					WHEN A.c_op = 'DP09' THEN 2
					WHEN A.c_op = 'DH06' THEN 3
					WHEN A.c_op = 'DH07' THEN 4
					WHEN A.c_op = 'LR02' THEN 5
					WHEN A.c_op = 'NHA01' THEN 6
					WHEN A.c_op = 'SCT01' THEN 7
					WHEN A.c_op = 'UV03' THEN 8
					WHEN A.c_op = 'DBDH' THEN 9
				END
	END
END

