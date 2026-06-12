-- PARAMS:
-- @donhang nvarchar

CREATE PROC [dbo].[DQT_PALLET_GETBYDONHANG](@donhang nvarchar(max))
AS
BEGIN
	SELECT B.id, B.pallet_id, B.sophieu, B.malo_nguyenlieu, C.nguyenlieu, 
		B.dayy, B.rong, B.dai, B.sothanh, B.sothanh_daxuat, B.sokhoi,
		D.nguongoc, B.donhang, B.phanloai,
		sothanh_conlai = B.sothanh - B.sothanh_daxuat,
		sokhoi_conlai = (B.dayy * B.rong * B.dai * (B.sothanh - B.sothanh_daxuat)) / 1000000000,
		B.dvt, OP.n_op,
		trangthai = CASE WHEN B.sothanh <= B.sothanh_daxuat THEN N'Xuất hết' ELSE N'Còn hàng' END,
		B.dain, B.ghichu, B.ngaytao, B.ngaysanxuat,
		FSC.fsc_name
	INTO #PALLET_TONKHO
	FROM dqt_pallet_chitiet B 
		INNER JOIN tr_nguyenlieu_gva C ON B.id_nguyenlieu = C.id
		LEFT JOIN tr_nguongoc D ON B.xuatxu = D.id
		LEFT JOIN trtb_m_op OP ON B.congdoan = OP.c_op
		LEFT JOIN tr_tinhtrang_fsc FSC ON B.fsc_id = FSC.fsc_id
	WHERE B.active = 1 AND B.donhang IN (SELECT LTRIM(RTRIM([value])) FROM string_split(@donhang, ','))

	SELECT madonhang, malo_nguyenlieu, B.nguongoc, C.fsc_name
	INTO #PHOI_DAUVAO
	FROM dqt_thongke_phoi A
		LEFT JOIN tr_nguongoc B ON A.xuatxu = B.id
		LEFT JOIN tr_tinhtrang_fsc C ON A.fsc_id = C.fsc_id
	WHERE A.madonhang IN (SELECT madonhang FROM #PALLET_TONKHO)
		AND LEN(A.madonhang) > 0
	GROUP BY madonhang, malo_nguyenlieu, B.nguongoc, C.fsc_name

	-- MÃ LÔ NGUYÊN LIỆU
	SELECT madonhang, malo_nguyenlieu = STRING_AGG(malo_nguyenlieu, ', ')
	INTO #DONHANG_MALO
	FROM (
		SELECT madonhang, malo_nguyenlieu
		FROM #PHOI_DAUVAO
		GROUP BY madonhang, malo_nguyenlieu
	) A GROUP BY madonhang

	-- NGUỒN GỐC
	SELECT madonhang, nguongoc = STRING_AGG(nguongoc, ', ')
	INTO #DONHANG_NGUONGOC
	FROM (
		SELECT madonhang, nguongoc
		FROM #PHOI_DAUVAO
		GROUP BY madonhang, nguongoc
	) A GROUP BY madonhang

	-- TÌNH TRẠNG FSC
	SELECT madonhang, fsc_name = STRING_AGG(fsc_name, ', ')
	INTO #DONHANG_FSC
	FROM (
		SELECT madonhang, fsc_name
		FROM #PHOI_DAUVAO
		GROUP BY madonhang, fsc_name
	) A GROUP BY madonhang

	SELECT A.id, A.pallet_id, A.sophieu, B.malo_nguyenlieu, A.nguyenlieu, 
		A.dayy, A.rong, A.dai, A.sothanh, A.sothanh_daxuat, A.sokhoi,
		C.nguongoc, A.donhang, A.phanloai,
		sothanh_conlai = A.sothanh - A.sothanh_daxuat,
		sokhoi_conlai = (A.dayy * A.rong * A.dai * (A.sothanh - A.sothanh_daxuat)) / 1000000000,
		A.dvt, A.n_op,
		trangthai = CASE WHEN A.sothanh <= A.sothanh_daxuat THEN N'Xuất hết' ELSE N'Còn hàng' END,
		A.dain, A.ghichu, A.ngaytao, A.ngaysanxuat,
		D.fsc_name
	FROM #PALLET_TONKHO A
		LEFT JOIN #DONHANG_MALO B ON A.donhang = B.madonhang
		LEFT JOIN #DONHANG_NGUONGOC C ON A.donhang = C.madonhang
		LEFT JOIN #DONHANG_FSC D ON A.donhang = D.madonhang

	DROP TABLE #PALLET_TONKHO, #PHOI_DAUVAO, #DONHANG_FSC, #DONHANG_NGUONGOC, #DONHANG_MALO;
END

