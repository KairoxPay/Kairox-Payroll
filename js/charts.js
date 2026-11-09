let payrollChartInstance = null;

function clearPayrollChart() {
  if (payrollChartInstance) {
    payrollChartInstance.destroy();
    payrollChartInstance = null;
  }
}

// Draws gross and net payroll for the labelled pay periods.
function renderPayrollChart(labels, grossValues, netValues) {
  const canvas = document.getElementById("payrollChart");

  if (!canvas || typeof Chart === "undefined") {
    return;
  }

  clearPayrollChart();

  const formatMoney = (value) =>
    Number(value || 0).toLocaleString("en-JM", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

  payrollChartInstance = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Gross payroll",
          data: grossValues,
          borderColor: "#5B2C83",
          backgroundColor: "rgba(91, 44, 131, 0.12)",
          borderWidth: 3,
          fill: true,
          tension: 0.35,
          pointRadius: 4,
          pointHoverRadius: 7
        },
        {
          label: "Net pay",
          data: netValues,
          borderColor: "#2CB8B3",
          borderWidth: 3,
          fill: false,
          tension: 0.35,
          pointRadius: 4,
          pointHoverRadius: 7
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: "bottom" },
        tooltip: {
          callbacks: {
            label: (context) =>
              `${context.dataset.label}: JMD ${formatMoney(context.parsed.y)}`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (value) => Number(value).toLocaleString("en-JM")
          }
        }
      }
    }
  });
}
