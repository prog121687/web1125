"use strict";

const travelCalculator = (() => {
  const DAY = 86400000;
  const VERSION = "2026-10-02";
  const DAILY = 25000;
  const caps = { seoul: 100000, metro: 80000, other: 70000 };
  const modes = {
    rail: "철도", sea: "선박", air: "항공", bus: "버스·기타 자동차",
    car: "자가용", approvedCar: "부득이한 자가용", official: "공용 교통수단",
  };
  const regions = { seoul: "서울특별시", metro: "광역시", other: "그 밖의 지역" };
  const money = new Intl.NumberFormat("ko-KR");

  function date(value) {
    const parsed = new Date(value + "T00:00:00Z");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(+parsed) ||
        parsed.toISOString().slice(0, 10) !== value) {
      throw new Error("출장일과 복귀일을 올바르게 입력하세요.");
    }
    return +parsed;
  }

  function time(value) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      throw new Error("출발 시각과 복귀 시각을 입력하세요.");
    }
    const [hour, minute] = value.split(":").map(Number);
    return hour * 60 + minute;
  }

  function integer(value, max, label) {
    const parsed = Number(value);
    if (value === "" || !Number.isSafeInteger(parsed) || parsed < 0 || parsed > max) {
      throw new Error(label + "에 0 이상 " + money.format(max) + " 이하의 정수를 입력하세요.");
    }
    return parsed;
  }

  const won = (amount) => money.format(amount) + "원";
  const dateLabel = (value, days) => new Date(value + days * DAY).toISOString().slice(0, 10);

  function calculateLocal(trip, days) {
    if (days !== 1) {
      throw new Error("근무지 내 출장은 날짜별 출장시간으로 계산합니다. 날짜가 다르면 하루씩 등록하세요.");
    }
    const minutes = time(trip.endTime) - time(trip.startTime);
    if (minutes <= 0) throw new Error("복귀 시각을 출발 시각보다 늦게 입력하세요.");
    const base = minutes >= 240 ? 20000 : 10000;
    const reason = minutes >= 240 ? "4시간 이상" : "4시간 미만";
    const isAssigned = trip.localVehicle === "assigned";
    const reduction = trip.localVehicle === "official" ? 10000 : 0;
    const amount = isAssigned ? 0 : base - reduction;
    const detail = isAssigned ? "전용 차량 배정자 미지급" :
      reason + " " + won(base) + (reduction ? " − 공무용 차량 등 " + won(reduction) : "");
    return {
      rows: [{ label: "근무지 내 출장여비", amount, detail: "제18조 · " + detail }],
      period: "근무지 내 · " + Math.floor(minutes / 60) + "시간 " + minutes % 60 + "분",
      settlement: [],
    };
  }

  function calculateOutside(trip, days, end, notes) {
    if (!["1", "2"].includes(trip.grade)) throw new Error("별표 1 지급 구분을 선택하세요.");
    const halfDays = integer(trip.halfDays, days, "일비 반액 대상 일수");
    const noMealDays = integer(trip.noMealDays, days, "별도 식비가 필요 없었던 일수");
    const savings = integer(trip.mileageSavings, 999999999, "마일리지 절감 운임");
    if (trip.lodging.length > days - 1) throw new Error("지급 대상 숙박 건수는 출장 기간의 최대 숙박일수를 넘을 수 없습니다.");

    const transportDetails = trip.transport.map(({ mode, amount }) => {
      if (!Object.hasOwn(modes, mode)) throw new Error("교통수단을 선택하세요.");
      const paid = mode === "official" ? 0 : integer(amount, 999999999, "인정 운임");
      return { paid, detail: modes[mode] + " " + won(paid) };
    });
    const lodgingDetails = trip.lodging.map(({ region, amount, extra }) => {
      if (!Object.hasOwn(caps, region)) throw new Error("숙박 지역을 선택하세요.");
      const paid = integer(amount, 999999999, "숙박 실지출액");
      const cap = caps[region];
      const base = trip.grade === "2" ? Math.min(cap, paid) : paid;
      const supplement = trip.grade === "2" && extra ? Math.min(paid - base, cap * 0.3) : 0;
      const detail = regions[region] + " " + won(base + supplement) +
        (base < paid ? " (기본 상한 " + won(cap) + (supplement ? ", 추가 " + won(supplement) : "") + ")" : "");
      return { base, supplement, detail };
    });
    const transport = transportDetails.reduce((sum, entry) => sum + entry.paid, 0);
    const lodging = lodgingDetails.reduce((sum, entry) => sum + entry.base + entry.supplement, 0);
    const supplement = lodgingDetails.some((entry) => entry.supplement > 0);

    let longReduction = 0;
    if (days > 16) {
      if (trip.samePlace && halfDays === 0) {
        // Arrival day is excluded. On day 17 the first excess day begins.
        const counted = days - 1;
        longReduction =
          Math.max(0, Math.min(counted, 30) - 15) * (DAILY / 10) +
          Math.max(0, Math.min(counted, 60) - 30) * (DAILY / 5) +
          Math.max(0, counted - 60) * (DAILY * 3 / 10);
      } else {
        notes.push(trip.samePlace
          ? "반액 일비와 장기체재가 겹칩니다. 날짜별로 대조할 장기체재 감액은 예상액에 반영하지 않았습니다."
          : "17일 이상 출장입니다. 같은 곳에서 15일을 초과해 체재한 구간이 있으면 제17조 감액을 따로 확인하세요.");
      }
    }
    if (savings > 0) notes.push("공적 항공마일리지로 절감한 운임 " + won(savings) +
      "에 따른 추가 일비는 소속기관이 확인하며 이 합계에는 반영하지 않았습니다.");
    if (trip.special) notes.push("표시 금액은 일반 지급 기준으로 계산했습니다. 기관 별도 기준과 특례는 담당자가 확인하세요.");

    const daily = DAILY * (days - halfDays) + DAILY / 2 * halfDays - longReduction;
    const dailyDetail = (days - halfDays) + "일 × " + won(DAILY) +
      (halfDays ? " + " + halfDays + "일 × " + won(DAILY / 2) : "") +
      (longReduction ? " − 장기체재 감액 " + won(longReduction) : "");
    const meal = DAILY * (days - noMealDays);
    const settlement = [];
    if (transport > 0 || lodging > 0) {
      settlement.push("운임·숙박비 기본 정산 기한 " + dateLabel(end, 14) + " · 제8조의2");
      settlement.push("운임과 숙박비의 세부 사용내역을 확인할 수 있는 증빙을 준비하세요.");
      if (supplement) settlement.push("숙박비 상한 초과분 추가 정산 기한 " + dateLabel(end, 7) +
        " · 제16조제2항 · 카드 매출전표 및 세부 사용 증빙");
    }
    return {
      rows: [
        { label: "운임", amount: transport, detail: "제10조~제15조 · " + (transportDetails.map((entry) => entry.detail).join(" / ") || "입력된 운임 없음") },
        { label: "일비", amount: daily, detail: "제16조·제17조 · " + dailyDetail },
        { label: "숙박비", amount: lodging, detail: "별표 2 · " + (lodgingDetails.map((entry) => entry.detail).join(" / ") || "입력된 숙박 없음") },
        { label: "식비", amount: meal, detail: "제16조 · " + (days - noMealDays) + "일 × " + won(DAILY) },
      ],
      period: "근무지 외 · 여행 " + days + "일 · 입력 숙박 " + trip.lodging.length + "박",
      settlement,
    };
  }

  function calculate(trip) {
    const start = date(trip.start);
    const end = date(trip.end);
    const days = (end - start) / DAY + 1;
    if (days <= 0) throw new Error("복귀일은 출장일보다 빠를 수 없습니다.");
    const notes = [];
    if (trip.start < VERSION) notes.push("출장일이 앱 기준 시행일(2026-10-02)보다 앞섭니다. 당시 규정을 따로 확인하세요.");
    const result = trip.kind === "local" ? calculateLocal(trip, days) : calculateOutside(trip, days, end, notes);
    return { ...result, notes, total: result.rows.reduce((sum, row) => sum + row.amount, 0) };
  }

  return { calculate, won, modes, caps };
})();
