-- PARAMS:
-- @ngaykiem date
-- @dondathang nvarchar
-- @macongdoan nvarchar
-- @nguoikiem nvarchar

CREATE   PROC [dbo].[TR_TIEUCHUAN_BAOCAO_QC_BAOCAO]
(
	@ngaykiem date,
	@dondathang nvarchar(50),
	@macongdoan nvarchar(50),
	@nguoikiem nvarchar(50)
)
AS
BEGIN
	SELECT B.Id, B.DanhMucLoi, A.TenLoi, B.tieuchuan
	INTO #DANHMUCLOI
	FROM tr_tieuchuan_loi A
	INNER JOIN tr_tieuchuan_loi_detail B ON A.Id = B.DanhMucLoi

	SELECT B.BaoCaoQC, A.TbMLocation, A.Dondathang,
		CD.tieuchuan AS tieuchuan_chatluong_id,
		TC.tieuchuan, TC.tieuchi,
		B.pallet_id, PL.mact, PL.tenct,
		B.soluongdat, B.soluongloi, b.soluongChiTietloi, B.soluongkiem, B.tileloi, B.ketqua,
		HL.[name] AS loailoi, HL.ma AS maloailoi, B.tinhtrang,
		PL.soluong_can, B.TieuChuanLoi,
		TC.stt
	INTO #BAOCAO
	FROM tr_tieuchuan_baocao_qc A
	INNER JOIN tr_tieuchuan_chatluong B ON A.Id = B.BaoCaoQC
	INNER JOIN tr_tieuchuan_congdoan CD ON B.tieuchuancongdoan = CD.Id
	INNER JOIN tr_tieuchuan TC ON CD.tieuchuan = TC.Id
	LEFT JOIN tr_tieuchuan_hangloi_loai HL ON B.loailoi = HL.ma
	LEFT JOIN tr_pallet PL ON B.pallet_id = PL.id
	WHERE A.TbMLocation = @macongdoan
		AND CAST(A.NgayLap AS date) = @ngaykiem
		AND A.Dondathang = @dondathang
		AND A.NguoiLap = @nguoikiem
		--AND B.soluongloi > 0

	SELECT A.BaoCaoQC, A.TbMLocation, A.Dondathang,
		A.tieuchuan_chatluong_id, A.tieuchuan, A.tieuchi,
		A.pallet_id, A.mact, A.tenct,
		A.soluongdat, A.soluongloi, A.soluongChiTietloi, A.soluongkiem, A.tileloi, A.ketqua,
		A.TieuChuanLoi, A.maloailoi, A.loailoi, B.TenLoi, A.tinhtrang, A.soluong_can,
		A.stt
	INTO #BAOCAO_CHATLUONG
	FROM #BAOCAO A
		LEFT JOIN #DANHMUCLOI B ON A.TieuChuanLoi = B.Id
	--ORDER BY A.stt

	DECLARE @nghiemtrong int, @nang int, @nhe int;
	SELECT
		@nghiemtrong = SUM(CASE WHEN maloailoi = 'Crt' THEN soluongChiTietloi ELSE 0 END),
		@nang = SUM(CASE WHEN maloailoi = 'Ma' THEN soluongChiTietloi ELSE 0 END),
		@nhe = SUM(CASE WHEN maloailoi = 'Mi' THEN soluongChiTietloi ELSE 0 END)
	FROM #BAOCAO_CHATLUONG

	DECLARE @dexuat nvarchar(max);
	SELECT @dexuat = COALESCE(@dexuat + ', ', '') + tinhtrang
	FROM #BAOCAO_CHATLUONG
	WHERE maloailoi IN ('Crt', 'Ma')
	GROUP BY tinhtrang

	SELECT A.*, 
		@nghiemtrong AS Crt,
		@nang AS Ma,
		@nhe AS Mi,
		@dexuat AS dexuat
	FROM #BAOCAO_CHATLUONG A
	ORDER BY stt

	DROP TABLE #DANHMUCLOI, #BAOCAO, #BAOCAO_CHATLUONG;
END
