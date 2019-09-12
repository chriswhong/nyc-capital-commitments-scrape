const fs = require('fs-extra')
const readline = require('readline')

const inputDir = process.argv[2]
const startingFy = inputDir.split('/')[2]

const formatCost = (rawCost) => {
  let negative = false
  if (rawCost.includes('-')) negative = true

  let formattedCost = parseInt(rawCost.replace(/,/g, ''), 10) * 1000

  if (negative) formattedCost *= -1

  return formattedCost
}

const sanitizeAsOfNumbers = (raw) => {
  return parseFloat(raw.replace(/,/g, ''))
}

// parses city and noncity numbers from budget line headers
const parseBudgetLineHeaders = (line) => {
  const city = sanitizeAsOfNumbers(line.match(/\$(.*)\(CITY\)/)[1].trim())
  const nonCity = sanitizeAsOfNumbers(line.match(/\$.*\$(.*)\(NON-CITY\)/)[1].trim())

  return { city, nonCity }
}

const parseLine = (line, budgetLine) => {
  // check for patterns of new budget line, new project, or commitment
  if (/BUDGET LINE/.test(line)) { // new budget line
    budgetLine.fy = startingFy
    budgetLine.budgetLineId = line.match(/BUDGET LINE:(.*)FMS/)[1].trim()
    budgetLine.fmsNumber = line.match(/FMS #:(.{1,10}).*/)[1].trim()
    budgetLine.description = line.match(/FMS #:.{1,10}(.*)/)[1].trim()
    console.log('New Budget Line', budgetLine.description)
  } else if (/AVAILABLE BALANCE AS OF/.test(line)) {
    if (budgetLine.budgetLineId && !budgetLine.availableBalance) { // only log values if following a budget line heading (exclude totals)
      const asOf = line.match(/\d{2}\/\d{2}\/\d{2}/)[0]
      const { city, nonCity } = parseBudgetLineHeaders(line)
      budgetLine.availableBalance = {
        asOf,
        city,
        nonCity,
        total: city + nonCity
      }
    }
  } else if (/CONTRACT LIABILITY/.test(line)) {
    if (budgetLine.budgetLineId && !budgetLine.contractLiability) { // only log values if following a budget line heading (exclude totals)
      const { city, nonCity } = parseBudgetLineHeaders(line)

      budgetLine.contractLiability = {
        city,
        nonCity
      }
    }
  } else if (/ITD EXPENDITURES/.test(line)) {
    if (budgetLine.budgetLineId && !budgetLine.itdExpenditures) { // only log values if following a budget line heading (exclude totals)
      const { city, nonCity } = parseBudgetLineHeaders(line)

      budgetLine.itdExpenditures = {
        city,
        nonCity
      }
    }
  } else if (/ADOPTED/.test(line)) {
    if (budgetLine.budgetLineId && !budgetLine.adoptedAppropriations) { // only log values if following a budget line heading (exclude totals)
      const [,
        adoptedFY0City,
        adoptedFY1City,
        adoptedFY2City,
        adoptedFY3City,
        ,
        commitmentFY0City,
        commitmentFY1City,
        commitmentFY2City,
        commitmentFY3City
      ] = line.split('*')

      budgetLine.adoptedAppropriations = [
        {
          period: 'FY0',
          city: formatCost(adoptedFY0City)
        },
        {
          period: 'FY1',
          city: formatCost(adoptedFY1City)
        },
        {
          period: 'FY2',
          city: formatCost(adoptedFY2City)
        },
        {
          period: 'FY3',
          city: formatCost(adoptedFY3City)
        }
      ]

      budgetLine.commitmentPlan = [
        {
          period: 'FY0',
          city: formatCost(commitmentFY0City)
        },
        {
          period: 'FY1',
          city: formatCost(commitmentFY1City)
        },
        {
          period: 'FY2',
          city: formatCost(commitmentFY2City)
        },
        {
          period: 'FY3',
          city: formatCost(commitmentFY3City)
        }
      ]
    }
  } else if (/^\s*\(N\)/.test(line) && budgetLine.adoptedAppropriations) {
    console.log('HEREHERE', line)
    const [,
      adoptedFY0NonCity,
      adoptedFY1NonCity,
      adoptedFY2NonCity,
      adoptedFY3NonCity,
      ,
      commitmentFY0NonCity,
      commitmentFY1NonCity,
      commitmentFY2NonCity,
      commitmentFY3NonCity
    ] = line.split('*')

    const { adoptedAppropriations, commitmentPlan } = budgetLine

    adoptedAppropriations[0].nonCity = formatCost(adoptedFY0NonCity)
    adoptedAppropriations[1].nonCity = formatCost(adoptedFY1NonCity)
    adoptedAppropriations[2].nonCity = formatCost(adoptedFY2NonCity)
    adoptedAppropriations[3].nonCity = formatCost(adoptedFY3NonCity)

    commitmentPlan[0].nonCity = formatCost(commitmentFY0NonCity)
    commitmentPlan[1].nonCity = formatCost(commitmentFY1NonCity)
    commitmentPlan[2].nonCity = formatCost(commitmentFY2NonCity)
    commitmentPlan[3].nonCity = formatCost(commitmentFY3NonCity)
  } else if (/^\s*\d{3}\s/.test(line)) { // beginning of new capital project
    if (budgetLine.budgetLineId) {
      const project = budgetLine.projects[budgetLine.projects.length - 1]
      project.managingAgency = line.match(/\d{3}/)[0]
      project.id = line.match(/\d{3}(.{1,10})/)[1].trim()
      project.description = `${line.match(/\d{3}.{1,10}(.{1,62})/)[1].replace(/"/g, '').replace(/ +(?= )/g, '').trim()}`
      console.log('    Capital Project', project.description)
    }
  } else if (/\s[A-Z]{4}\s.{2}\s\S{1,3}\s/.test(line)) { // commitments
    if (budgetLine.budgetLineId) {
      const project = budgetLine.projects[budgetLine.projects.length - 1]
      const category = line.substring(18, 22)
      const subcategory = line.substring(23, 25).trim()
      const code = line.substring(26, 29)
      const categoryDescription = line.substring(30, 59).trim()
      const subcategoryDescription = line.substring(59, 87).trim()

      // numbers/dates
      const chunks = line.substring(84, line.length).trim().split(/\s+/)
      const cityCost = formatCost(chunks[0])
      const nonCityCost = formatCost(chunks[1])
      const planCommDate = chunks[2]

      const commitDetailObject = {
        code,
        category,
        categoryDescription,
        subcategory,
        subcategoryDescription,
        cost: {
          city: cityCost,
          nonCity: nonCityCost
        },
        planCommDate
      }

      project.commitments.push(commitDetailObject)
      console.log(line)
      console.log('        Commitment', categoryDescription)
    }
  }

  return budgetLine
}

const parseTxtFile = (inputDir, file, output) => {
  return new Promise ((resolve, reject) => {
    try {
      console.log(inputDir, file)

      const readInterface = readline.createInterface({
        input: fs.createReadStream(`${inputDir}/${file}`),
        console: false
      })

      let i = 0
      let budgetLine = {
        projects: []
      }

      readInterface.on('line', (line) => {
        // check to see if current line closes previous budgetLine
        // if so, write it to file and reset before proceeding
        const closeBudgetLine = !!/TOTALS FOR/.test(line) || !!/BUDGET LINE/.test(line)
        if (closeBudgetLine && budgetLine.budgetLineId) {
          output.write(`${i > 0 ? ',' : ''}${JSON.stringify(budgetLine, null, 2)}`)
          i += 1
          budgetLine = {
            projects: []
          }
        }

        // if the line should start a new capital project, insert an empty object into budgetline.projects
        if (budgetLine.budgetLineId && /^\s*\d{3}\s/.test(line)) {
          budgetLine.projects.push({
            commitments: []
          })
        }

        budgetLine = parseLine(line, budgetLine)
      })

      readInterface.on('close', () => {
        resolve()
      })
    } catch(e) {
      reject(e)
    }
  })
}

(async () => {
  const files = fs.readdirSync(`${inputDir}`)
  // create an output file, add open array bracket
  const outputPath = `${inputDir}/../${startingFy}.json`
  fs.ensureFileSync(outputPath)
  const output = fs.createWriteStream(outputPath)
  output.write('[\n')

  for (let [i, file] of files.entries()) {
    console.log(i, files.length)
    console.log(`Parsing ${inputDir}/${file}`)
    await parseTxtFile(inputDir, file, output)
    if ((i < files.length - 1)) output.write(',')
  }


  output.write(']')
})()
