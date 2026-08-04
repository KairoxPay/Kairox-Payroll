  const payrollChartElement = document.getElementById("payrollChart");

  if (payrollChartElement) {
    new Chart(payrollChartElement, {
      type: "line",

      data: {
        labels: [
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul"
        ],

        datasets: [
          {
            label: "Payroll",

            data: [
              845000,
              910000,
              975000,
              1060000,
              1180000,
              1245750
            ],

            borderColor: "#5B2C83",
            backgroundColor: "rgba(91, 44, 131, 0.12)",
            borderWidth: 4,
            fill: true,
            tension: 0.35,
            pointRadius: 5,
            pointHoverRadius: 8
          }
        ]
      },

      options: {
        responsive: true,
        maintainAspectRatio: false,

        plugins: {
          legend: {
            display: false
          }
        },

        scales: {
          y: {
            beginAtZero: false
          }
        }
      }
    });
  }